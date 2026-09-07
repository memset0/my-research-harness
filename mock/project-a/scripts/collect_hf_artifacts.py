#!/usr/bin/env python3
"""Fixture collector for W0005: HF artifact score by resolution (E0003)."""
import json
print(json.dumps({"columns": ["resolution", "uniform_loss", "snr_weighted_loss"],
                  "rows": [[64, 0.41, 0.29], [128, 0.38, 0.27]]}))
