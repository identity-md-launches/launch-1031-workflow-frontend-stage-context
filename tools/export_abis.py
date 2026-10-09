#!/usr/bin/env python3
"""Export reproducible application ABIs from an already completed forge build."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = (
    "LaunchToken", "PawnShop", "LendingPool", "LockDiscount",
    "CollateralVault", "MilestoneBurn", "VaultFactory", "FloorRelay",
)
destination = ROOT / "docs" / "abi"
destination.mkdir(parents=True, exist_ok=True)
for name in CONTRACTS:
    artifact = ROOT / "out" / f"{name}.sol" / f"{name}.json"
    abi = json.loads(artifact.read_text())["abi"]
    (destination / f"{name}.json").write_text(json.dumps(abi, indent=2) + "\n")
