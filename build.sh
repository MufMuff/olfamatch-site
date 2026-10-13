#!/bin/sh
set -e
python3 build.py
python3 pdf_top30.py
