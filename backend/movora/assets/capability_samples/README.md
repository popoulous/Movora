# Movora Demo Capability Samples

Calm synthetic codec probe clips for Movora webOS/TV capability testing, served by
`GET /api/capabilities/samples` (manifest) and `GET /api/capabilities/samples/{id}`
(file). The TV client plays each one to confirm what it can really decode —
`canPlayType` is only advisory, so a real playback probe is the ground truth
(IMPLEMENTATION_PLAN §13.4).

No anime/movie footage, no third-party artwork, no external logos, no music
samples — synthetic visuals + a generated soft ambient tone + synthetic WebVTT.

## Provenance

The base clips (`*_aac.mp4`, `*_subtitle_test.vtt`) are generated externally
(branded synthetic source). The container/audio variants below are derived from
`movora_demo_h264_high_l41_720p_aac.mp4` with ffmpeg (stream copy on video, so the
video codec is unchanged; only the container or audio codec differs):

```sh
B=movora_demo_h264_high_l41_720p_aac.mp4

# Container probes (real-world: most originals are MKV)
ffmpeg -i $B                          -c copy            movora_demo_h264_high_l41_720p_aac_mkv.mkv
ffmpeg -i movora_demo_hevc10_720p_aac.mp4 -c copy        movora_demo_hevc10_720p_aac_mkv.mkv

# Audio codec probes (video stream copied, audio re-encoded)
ffmpeg -i $B -c:v copy -c:a ac3   -b:a 192k             movora_demo_h264_ac3.mp4
ffmpeg -i $B -c:v copy -c:a eac3  -b:a 192k             movora_demo_h264_eac3.mp4
ffmpeg -i $B -c:v copy -c:a dca   -strict -2 -b:a 768k  movora_demo_h264_dts_mkv.mkv
ffmpeg -i $B -c:v copy -c:a flac                        movora_demo_h264_flac.mp4
ffmpeg -i $B -c:v copy -c:a libopus -b:a 192k           movora_demo_h264_opus_mkv.mkv
```

(Dolby TrueHD was intentionally skipped — the ffmpeg `truehd` encoder produced no
packets for these short stereo clips, and TrueHD is rare for streamed content.)

Add a new probe by dropping the file here and adding an entry to `manifest.json`
(`id`, `category`, `filename`, `label`, `mime`).
