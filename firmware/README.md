# firmware/

Reserved for the ESP32 wristband sketch (GPS, GSM, SOS button, LED, buzzer).

Not implemented yet — this is built in **Phase 12 (ESP32 Hardware)** and
**Phase 13 (ESP32 ↔ Backend Integration)**, after the software stack and the
GPS/SOS simulator (Phases 5–11) are in place. Firmware will target the same
`/api/devices/:id/telemetry` contract the simulator uses, so the swap from
simulated to real hardware does not require backend changes.
