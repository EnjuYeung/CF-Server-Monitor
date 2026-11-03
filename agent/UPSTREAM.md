# Source provenance

Imported from https://github.com/huilang-me/cfsm-agent at stable release **v1.0.16**,
commit `10e4938e999d8b30b4d9296df4c686983bfdb762` (verified 2026-09-16).
The original MIT license is preserved in `LICENSE`; `UPSTREAM_README.md` is the
unmodified upstream documentation, not this fork's installation instructions.

Native Agent versions are independent of the controller and start at v1.1.0.
Metrics collectors, network probes, traffic accounting, HTTP/WebSocket reporting,
remote configuration, and platform service management come from this release.
Adaptations replace the distribution/update source, support CONTROLLER_URL while
retaining WORKER_URL compatibility, and add reproducible multi-platform builds.

Agent **v1.3.2** selectively adapts upstream commit
`3d1c73768442159d0c0e136121d15a84d35e1025` (2026-10-22): failed network
reads preserve counter baselines and traffic totals, checkpoint failures are
reported, collector commands have bounded execution/pipe waits, report and
correction requests follow shutdown cancellation, and install corrections are
validated before service/file changes. Local adaptations retain ControllerURL,
normal operational warnings, the 300-sample retry buffer, and self-hosted
Linux amd64/arm64 distribution. This is not a change of the v1.0.16 baseline;
upstream discovery, GitHub updates and extra platforms are not imported.
