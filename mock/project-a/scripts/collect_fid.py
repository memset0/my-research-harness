#!/usr/bin/env python3
"""Fixture collector for W0006: emits the FID rows stored in the showcase bundle."""
import argparse, csv, json, pathlib
p = argparse.ArgumentParser(); p.add_argument("--exp", default="E0004"); p.parse_args()
src = pathlib.Path("docs/wiki/showcase/W0006-edm2-precond-explorer/data/fid.csv")
rows = [[int(r["step"]), r["precond"], float(r["fid"])] for r in csv.DictReader(src.open())]
print(json.dumps({"columns": ["step", "precond", "fid"], "rows": rows}))
