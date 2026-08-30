"""Headless projection library.

Pure functions only: no network, no file I/O, no ``print``, no ``sys.exit``.
Scripts under ``scripts/`` load data from ``data/``, call into here, and write
the results back out. See the plan doc (KTD1) for the ``engine/`` + ``scripts/``
split this package implements.
"""
