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

# More video codecs / resolutions (the easy synthetic clips all decode, so these
# stress real capability: 4K, 10-bit, HDR10, Hi10P, VP9, AV1, old MPEG-4 ASP)
ffmpeg -i $B -vf scale=3840:2160 -c:v libx265 -profile:v main10 -pix_fmt yuv420p10le -preset veryfast -crf 24 -c:a copy   movora_demo_hevc10_2160p_mkv.mkv
ffmpeg -i $B -vf "scale=3840:2160,format=yuv420p10le,setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc" \
       -c:v libx265 -preset veryfast -crf 24 -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc \
       -x265-params 'colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:hdr-opt=1:repeat-headers=1:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400' \
       -c:a copy                                                                        movora_demo_hevc10_2160p_hdr10_mkv.mkv
ffmpeg -i $B -vf scale=3840:2160 -c:v libx264 -profile:v high -level 5.1 -preset veryfast -crf 23 -pix_fmt yuv420p -c:a copy  movora_demo_h264_2160p.mp4
ffmpeg -i $B -vf scale=1920:1080 -c:v libx264 -profile:v high10 -pix_fmt yuv420p10le -preset veryfast -crf 20 -c:a copy       movora_demo_h264_hi10p_1080p_mkv.mkv
ffmpeg -i $B -vf scale=1920:1080 -c:v libvpx-vp9 -b:v 0 -crf 34 -deadline realtime -cpu-used 8 -c:a libopus -b:a 128k          movora_demo_vp9_1080p.webm
ffmpeg -i $B -vf scale=3840:2160 -c:v libsvtav1 -preset 10 -crf 40 -c:a copy                                                  movora_demo_av1_2160p.mp4
ffmpeg -i $B -vf scale=720:480  -c:v libxvid -q:v 5 -c:a libmp3lame -b:a 192k                                                 movora_demo_xvid_480p.avi

# Container probes (most originals are MKV; broadcast/stream is TS)
ffmpeg -i $B -c copy                                    movora_demo_h264_high_l41_720p_aac_mkv.mkv
ffmpeg -i movora_demo_hevc10_720p_aac.mp4 -c copy       movora_demo_hevc10_720p_aac_mkv.mkv
ffmpeg -i $B -c copy -f mpegts                          movora_demo_h264_ts.ts

# Audio codec probes (video stream copied, audio re-encoded; -ac 6 = 5.1)
ffmpeg -i $B -c:v copy -c:a aac     -ac 6 -b:a 384k             movora_demo_h264_aac51.mp4
ffmpeg -i $B -c:v copy -c:a ac3     -b:a 192k                   movora_demo_h264_ac3.mp4
ffmpeg -i $B -c:v copy -c:a eac3    -b:a 192k                   movora_demo_h264_eac3.mp4
ffmpeg -i $B -c:v copy -c:a eac3    -ac 6 -b:a 384k             movora_demo_eac3_51_mkv.mkv
ffmpeg -i $B -c:v copy -c:a dca     -strict -2 -b:a 768k        movora_demo_h264_dts_mkv.mkv
ffmpeg -i $B -c:v copy -c:a dca     -strict -2 -ac 6 -b:a 1536k movora_demo_dts_51_mkv.mkv
ffmpeg -i $B -c:v copy -c:a flac                                movora_demo_h264_flac.mp4
ffmpeg -i $B -c:v copy -c:a pcm_s16le                           movora_demo_h264_pcm_mkv.mkv
ffmpeg -i $B -c:v copy -c:a libopus -b:a 192k                   movora_demo_h264_opus_mkv.mkv
ffmpeg -i $B -c:v copy -c:a libvorbis -q:a 5                    movora_demo_h264_vorbis_mkv.mkv
ffmpeg -i $B -c:v copy -c:a libmp3lame -b:a 192k               movora_demo_h264_mp3.mp4
```

Not generatable here (no ffmpeg encoder), so they are intentionally absent — note
them as "untested" if a device needs them: **VC-1**, **DTS-HD MA**, **Dolby
TrueHD** (its encoder produced no packets for these short clips), **Dolby Vision**.

Add a new probe by dropping the file here and adding an entry to `manifest.json`
(`id`, `category`, `filename`, `label`, `mime`).
