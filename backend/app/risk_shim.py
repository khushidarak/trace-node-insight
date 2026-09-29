"""Import bridge so the app package can reference pipeline.alerts as a module
without relative-import gymnastics."""

from pipeline import alerts as alerts_mod  # noqa: F401  (re-export)
