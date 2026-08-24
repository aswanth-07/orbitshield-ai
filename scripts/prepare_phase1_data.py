from __future__ import annotations

import csv
import io
import json
import math
import re
import tempfile
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "app" / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

USER_AGENT = "OrbitShield-AI/1.0 college prototype (github.com/aswanth-07/orbitshield-ai)"
ACTIVE_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=JSON"
ACTIVE_MIRROR_URL = (
    "https://raw.githubusercontent.com/satvisorcom/satvisor-data/"
    "master/celestrak/json/active.json"
)
SOCRATES_DIR_URL = "https://celestrak.org/SOCRATES/jsonDir.php"
SOCRATES_SEARCH_URL = "https://celestrak.org/SOCRATES/search.php"
ESA_TRAIN_URL = (
    "https://live.kelvins.esa.int/media/public/competitions/"
    "collision-avoidance-challenge/train_data.zip"
)

INDIA_FLEET = {
    41877: "Resourcesat-2A",
    44804: "Cartosat-3",
    44233: "RISAT-2B",
    54361: "EOS-6 / Oceansat-3",
    43111: "Cartosat-2F",
    37387: "Resourcesat-2",
}

OMM_FIELDS = [
    "OBJECT_NAME",
    "OBJECT_ID",
    "EPOCH",
    "MEAN_MOTION",
    "ECCENTRICITY",
    "INCLINATION",
    "RA_OF_ASC_NODE",
    "ARG_OF_PERICENTER",
    "MEAN_ANOMALY",
    "EPHEMERIS_TYPE",
    "CLASSIFICATION_TYPE",
    "NORAD_CAT_ID",
    "ELEMENT_SET_NO",
    "REV_AT_EPOCH",
    "BSTAR",
    "MEAN_MOTION_DOT",
    "MEAN_MOTION_DDOT",
    "OBJECT_TYPE",
    "COUNTRY_CODE",
    "LAUNCH_DATE",
    "DECAY_DATE",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def fetch_bytes(url: str, timeout: int = 120) -> tuple[bytes, dict[str, str]]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "*/*"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError(f"{url} returned HTTP {response.status}")
        headers = {key.lower(): value for key, value in response.headers.items()}
        return response.read(), headers


def write_json(path: Path, value: object) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def prepare_active_catalog() -> None:
    output_path = DATA_DIR / "active-catalog.snapshot.json"
    if output_path.exists():
        print("Reusing prepared active catalogue snapshot")
        return
    source = ACTIVE_URL
    try:
        raw, headers = fetch_bytes(ACTIVE_URL)
    except urllib.error.HTTPError as error:
        if error.code != 403:
            raise
        source = ACTIVE_MIRROR_URL
        raw, headers = fetch_bytes(ACTIVE_MIRROR_URL)
    records = json.loads(raw)
    minimized = [
        {key: record.get(key) for key in OMM_FIELDS if record.get(key) is not None}
        for record in records
    ]
    payload = {
        "source": source,
        "upstream": ACTIVE_URL,
        "sourceUpdatedAt": headers.get("last-modified"),
        "fetchedAt": now_iso(),
        "count": len(minimized),
        "objects": minimized,
    }
    write_json(output_path, payload)
    print(f"Prepared active catalogue: {len(minimized):,} objects")


def parse_socrates_run_metadata(html: str) -> dict[str, object]:
    current = re.search(r"Data current as of\s+([^<\r\n]+)", html, re.I)
    interval = re.search(
        r"Computation Interval:\s*Start\s*=\s*([^,<]+),\s*Stop\s*=\s*([^<\r\n]+)",
        html,
        re.I,
    )
    threshold = re.search(r"Computation Threshold:\s*([0-9.]+)\s*km", html, re.I)
    considering = re.search(
        r"Considering:\s*([\d,]+)\s*Primaries,\s*([\d,]+)\s*Secondaries\s*\(([\d,]+)\s*Conjunctions\)",
        html,
        re.I,
    )
    return {
        "currentAsOf": current.group(1).strip() if current else None,
        "start": interval.group(1).strip() if interval else None,
        "stop": interval.group(2).strip() if interval else None,
        "thresholdKm": float(threshold.group(1)) if threshold else None,
        "primaryCount": int(considering.group(1).replace(",", "")) if considering else None,
        "secondaryCount": int(considering.group(2).replace(",", "")) if considering else None,
        "conjunctionCount": int(considering.group(3).replace(",", "")) if considering else None,
    }


def normalize_socrates_row(row: dict[str, str]) -> dict[str, object]:
    def number(key: str) -> float | None:
        try:
            value = float(row.get(key, ""))
            return value if math.isfinite(value) else None
        except (TypeError, ValueError):
            return None

    return {
        "primaryCatalogId": int(row["NORAD_CAT_ID_1"]),
        "primaryName": row["OBJECT_NAME_1"],
        "primaryElementAgeDays": number("DSE_1"),
        "secondaryCatalogId": int(row["NORAD_CAT_ID_2"]),
        "secondaryName": row["OBJECT_NAME_2"],
        "secondaryElementAgeDays": number("DSE_2"),
        "tca": row["TCA"].replace(" ", "T", 1) + "Z",
        "rangeKm": number("TCA_RANGE"),
        "relativeSpeedKmS": number("TCA_RELATIVE_SPEED"),
        "maximumProbability": number("MAX_PROB"),
        "dilutionKm": number("DILUTION"),
    }


def prepare_socrates_snapshot() -> None:
    output_path = DATA_DIR / "socrates-fleet.snapshot.json"
    if output_path.exists():
        print("Reusing prepared SOCRATES fleet snapshot")
        return
    directory_raw, _ = fetch_bytes(SOCRATES_DIR_URL)
    directory = json.loads(directory_raw)
    if isinstance(directory, list):
        directory = directory[0]
    file_name = directory["FILE_NAME"]
    file_url = f"https://celestrak.org/SOCRATES/{file_name}"
    matches_by_key: dict[str, dict[str, object]] = {}
    run: dict[str, object] = {}
    for catalog_id in INDIA_FLEET:
        query_url = (
            "https://celestrak.org/SOCRATES/table-socrates.php?"
            f"CATNR={catalog_id},&ORDER=MAXPROB&MAX=1000"
        )
        html_raw, _ = fetch_bytes(query_url)
        html = html_raw.decode("utf-8", errors="replace")
        if not run:
            run = parse_socrates_run_metadata(html)
        tables = pd.read_html(io.StringIO(html))
        data_tables = [table for table in tables if len(table) >= 2 and len(table.columns) == 7]
        if not data_tables:
            continue
        table = data_tables[0]
        rows = [
            row
            for row in table.to_numpy().tolist()
            if re.fullmatch(r"\d+", str(row[1]).strip())
        ]
        for index in range(0, len(rows) - 1, 2):
            first, second = rows[index], rows[index + 1]
            row = {
                "NORAD_CAT_ID_1": str(first[1]),
                "OBJECT_NAME_1": str(first[2]),
                "DSE_1": str(first[3]),
                "NORAD_CAT_ID_2": str(second[1]),
                "OBJECT_NAME_2": str(second[2]),
                "DSE_2": str(second[3]),
                "TCA": str(first[4]),
                "TCA_RANGE": str(first[5]),
                "TCA_RELATIVE_SPEED": str(first[6]),
                "MAX_PROB": str(second[5]),
                "DILUTION": str(second[6]),
            }
            normalized = normalize_socrates_row(row)
            key = (
                f"{normalized['primaryCatalogId']}:"
                f"{normalized['secondaryCatalogId']}:"
                f"{normalized['tca']}"
            )
            matches_by_key[key] = normalized

    matches = list(matches_by_key.values())
    payload = {
        "source": file_url,
        "directory": directory,
        "sourceUpdatedAt": directory.get("FILE_MTIME"),
        "fetchedAt": now_iso(),
        "run": run,
        "rawRowCount": run.get("conjunctionCount"),
        "fleet": [
            {"catalogId": catalog_id, "name": name}
            for catalog_id, name in INDIA_FLEET.items()
        ],
        "events": matches,
    }
    write_json(output_path, payload)
    print(
        "Prepared SOCRATES snapshot: "
        f"{len(matches):,} fleet events of {run.get('conjunctionCount', 'unknown')}"
    )


ESA_USECOLS = [
    "event_id",
    "time_to_tca",
    "risk",
    "max_risk_estimate",
    "miss_distance",
    "relative_speed",
    "relative_position_r",
    "relative_position_t",
    "relative_position_n",
    "relative_velocity_r",
    "relative_velocity_t",
    "relative_velocity_n",
    "mission_id",
    "c_object_type",
    "geocentric_latitude",
    "t_position_covariance_det",
    "c_position_covariance_det",
    "t_obs_used",
    "c_obs_used",
]


def finite_or_none(value: object) -> float | int | str | None:
    if pd.isna(value):
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if hasattr(value, "item"):
        return value.item()
    return value  # type: ignore[return-value]


def prepare_esa_sample() -> None:
    archive_path = Path(tempfile.gettempdir()) / "orbitshield-esa-train-data.zip"
    if not archive_path.exists():
        raw, _ = fetch_bytes(ESA_TRAIN_URL, timeout=240)
        archive_path.write_bytes(raw)

    with zipfile.ZipFile(archive_path) as archive:
        csv_names = [name for name in archive.namelist() if name.lower().endswith(".csv")]
        if not csv_names:
            raise RuntimeError("ESA archive contains no CSV file")
        with archive.open(csv_names[0]) as stream:
            frame = pd.read_csv(stream, usecols=ESA_USECOLS)

    candidates: list[tuple[float, int, pd.DataFrame]] = []
    for event_id, group in frame.groupby("event_id", sort=True):
        ordered = group.sort_values("time_to_tca", ascending=False)
        visible = ordered[ordered["time_to_tca"] >= 2.0]
        if len(ordered) < 8 or len(visible) < 3:
            continue
        required = visible[["risk", "miss_distance", "relative_speed"]].dropna()
        if len(required) < 3:
            continue
        final_risk = ordered.iloc[-1]["risk"]
        baseline = visible.iloc[-1]["risk"]
        final_time_to_tca = ordered.iloc[-1]["time_to_tca"]
        if (
            pd.isna(final_risk)
            or pd.isna(baseline)
            or final_risk < -4.0
            or pd.isna(final_time_to_tca)
            or float(final_time_to_tca) >= 2.0
        ):
            continue
        change = abs(float(final_risk) - float(baseline))
        trend = float(visible["risk"].max() - visible["risk"].min())
        score = change * 3 + trend + min(len(visible), 20) / 100
        candidates.append((score, int(event_id), ordered))

    if not candidates:
        raise RuntimeError("Could not find a suitable ESA validation event")

    _, event_id, ordered = max(candidates, key=lambda item: (item[0], -item[1]))
    visible = ordered[ordered["time_to_tca"] >= 2.0]
    final_row = ordered.iloc[-1]

    def row_to_dict(row: pd.Series) -> dict[str, object]:
        return {column: finite_or_none(row[column]) for column in ESA_USECOLS if column != "event_id"}

    payload = {
        "source": ESA_TRAIN_URL,
        "sourcePage": "https://live.kelvins.esa.int/collision-avoidance-challenge/data/",
        "preparedAt": now_iso(),
        "eventId": event_id,
        "reservedForValidation": True,
        "cutoffDays": 2,
        "visibleCdms": [row_to_dict(row) for _, row in visible.iterrows()],
        "recordedOutcome": row_to_dict(final_row),
        "fullCdmCount": len(ordered),
    }
    write_json(DATA_DIR / "esa-validation-event.json", payload)
    print(
        "Prepared ESA validation event: "
        f"{event_id} with {len(visible)} visible CDMs and {len(ordered)} total"
    )


if __name__ == "__main__":
    prepare_active_catalog()
    prepare_socrates_snapshot()
    prepare_esa_sample()
