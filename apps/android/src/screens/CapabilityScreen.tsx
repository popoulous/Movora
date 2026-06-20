import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Video, {type OnLoadData} from 'react-native-video';

import {sampleUrl, type CapabilityProbeOutcome, type ServerSample} from '../api/client';
import {useDevice} from '../context/DeviceContext';
import {useI18n} from '../i18n';
import type {RootStackParamList} from '../navigation';
import {theme} from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Capability'>;

type Phase = 'loading' | 'probing' | 'audio' | 'reporting' | 'done' | 'error';

const PROBE_TIMEOUT_MS = 8000;

// Real playback probe. Video/container samples auto-probe (does the clip decode?). Audio
// codecs can't be measured on Android (a track may be listed yet play silent, e.g. DTS),
// so — like apps/webos — the user confirms each audio clip by ear. Subtitles aren't probed
// (the backend reads the explicit supports_* flags). Mirrors apps/webos.
export default function CapabilityScreen({navigation}: Props): React.JSX.Element {
  const {api, config} = useDevice();
  const {t} = useI18n();
  const insets = useSafeAreaInsets();
  const [samples, setSamples] = useState<ServerSample[]>([]);
  const [idx, setIdx] = useState(0);
  const [audioIdx, setAudioIdx] = useState(0);
  const [results, setResults] = useState<Record<string, CapabilityProbeOutcome>>({});
  const [phase, setPhase] = useState<Phase>('loading');
  const settled = useRef(false);

  const base = config?.serverUrl ?? '';

  // Auto-probed (video/container) vs ear-tested (audio); subtitles are display-only.
  const probeable = useMemo(
    () => samples.filter(s => s.category === 'video' || s.category === 'container'),
    [samples],
  );
  const audioSamples = useMemo(() => samples.filter(s => s.category === 'audio'), [samples]);

  useEffect(() => {
    if (!api) {
      return;
    }
    api
      .getCapabilitySamples()
      .then(s => {
        setSamples(s);
        setPhase(s.length > 0 ? 'probing' : 'done');
      })
      .catch(() => setPhase('error'));
  }, [api]);

  const record = (sample: ServerSample, outcome: CapabilityProbeOutcome): void => {
    setResults(r => ({...r, [sample.id]: outcome}));
  };

  // --- Auto-probe (video/container) ---------------------------------------
  useEffect(() => {
    if (phase !== 'probing' || idx >= probeable.length) {
      return undefined;
    }
    settled.current = false;
    const sample = probeable[idx];
    const timer = setTimeout(() => {
      if (!settled.current) {
        settled.current = true;
        record(sample, emptyOutcome(false));
        setIdx(i => i + 1);
      }
    }, PROBE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase, idx, probeable]);

  const onLoad = (data: OnLoadData): void => {
    if (settled.current || idx >= probeable.length) {
      return;
    }
    settled.current = true;
    record(probeable[idx], {
      played: true,
      video_bytes: 0,
      audio_bytes: 0,
      has_audio: (data.audioTracks?.length ?? 0) > 0,
      audio_rms: null,
      cues: null,
    });
    setIdx(i => i + 1);
  };

  const onError = (): void => {
    if (settled.current || idx >= probeable.length) {
      return;
    }
    settled.current = true;
    record(probeable[idx], emptyOutcome(false));
    setIdx(i => i + 1);
  };

  // Auto-probe done -> ear-test the audio clips (or report if there are none).
  useEffect(() => {
    if (phase === 'probing' && idx >= probeable.length) {
      setPhase(audioSamples.length > 0 ? 'audio' : 'reporting');
    }
  }, [phase, idx, probeable.length, audioSamples.length]);

  // --- Manual audio listen test -------------------------------------------
  const answerAudio = (heard: boolean): void => {
    const sample = audioSamples[audioIdx];
    if (sample) {
      record(sample, {played: true, video_bytes: 0, audio_bytes: 0, has_audio: heard, audio_rms: null, cues: null});
    }
    setAudioIdx(i => i + 1);
  };

  useEffect(() => {
    if (phase === 'audio' && audioIdx >= audioSamples.length) {
      setPhase('reporting');
    }
  }, [phase, audioIdx, audioSamples.length]);

  // --- Report to the backend ----------------------------------------------
  useEffect(() => {
    if (phase !== 'reporting') {
      return;
    }
    api
      ?.reportCapabilities({
        probe: results,
        supports_ass: false, // ExoPlayer can't render ASS; we serve VTT instead
        supports_srt: true,
        supports_vtt: true,
        user_agent: 'Movora Android',
      })
      .then(() => setPhase('done'))
      .catch(() => setPhase('error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const probeClip = phase === 'probing' && idx < probeable.length ? probeable[idx] : null;
  const audioClip = phase === 'audio' && audioIdx < audioSamples.length ? audioSamples[audioIdx] : null;

  return (
    <View style={[styles.root, {paddingTop: insets.top}]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹ {t('common.back')}</Text>
        </Pressable>
        <Text style={styles.title}>{t('cap.title')}</Text>
        <Text style={styles.intro}>{t('cap.intro')}</Text>
      </View>

      {phase === 'loading' && <ActivityIndicator color={theme.accent} style={styles.loading} />}
      {phase === 'error' && <Text style={styles.error}>{t('cap.error')}</Text>}
      {(phase === 'probing' || phase === 'reporting') && (
        <Text style={styles.progress}>
          {t('cap.progress', {done: Math.min(idx, probeable.length), total: probeable.length})}
        </Text>
      )}
      {phase === 'done' && <Text style={styles.doneText}>{t('cap.done')}</Text>}

      {/* Manual audio listen prompt */}
      {audioClip && (
        <View style={styles.audioPanel}>
          <Text style={styles.audioCount}>
            {audioIdx + 1} / {audioSamples.length}
          </Text>
          <Text style={styles.audioLabel}>{audioClip.label}</Text>
          <Text style={styles.audioPrompt}>{t('cap.audioListen')}</Text>
          <View style={styles.audioBtns}>
            <Pressable style={[styles.audioBtn, styles.audioYes]} onPress={() => answerAudio(true)}>
              <Text style={styles.audioBtnText}>{t('cap.yes')}</Text>
            </Pressable>
            <Pressable style={[styles.audioBtn, styles.audioNo]} onPress={() => answerAudio(false)}>
              <Text style={styles.audioBtnText}>{t('cap.no')}</Text>
            </Pressable>
          </View>
        </View>
      )}

      <FlatList
        data={samples}
        keyExtractor={s => s.id}
        contentContainerStyle={styles.list}
        renderItem={({item}) => {
          const r = results[item.id];
          const mark =
            item.category === 'subtitle'
              ? item.id.startsWith('ass')
                ? '→VTT'
                : '✓'
              : item.category === 'audio'
                ? r === undefined
                  ? '·'
                  : r.has_audio
                    ? '✓'
                    : '✗'
                : r === undefined
                  ? '·'
                  : r.played
                    ? '✓'
                    : '✗';
          return (
            <View style={styles.row}>
              <Text style={styles.rowLabel} numberOfLines={1}>
                {item.label}
              </Text>
              <Text style={styles.rowMark}>{mark}</Text>
            </View>
          );
        }}
      />

      {/* Off-screen prober: video/container muted (auto), audio unmuted (listen test). */}
      {probeClip && (
        <Video
          key={probeClip.id}
          source={{uri: sampleUrl(base, probeClip.id)}}
          style={styles.probe}
          muted
          paused={false}
          onLoad={onLoad}
          onError={onError}
        />
      )}
      {audioClip && (
        <Video
          key={audioClip.id}
          source={{uri: sampleUrl(base, audioClip.id)}}
          style={styles.probe}
          paused={false}
          onError={() => answerAudio(false)}
        />
      )}
    </View>
  );
}

function emptyOutcome(played: boolean): CapabilityProbeOutcome {
  return {played, video_bytes: 0, audio_bytes: 0, has_audio: null, audio_rms: null, cues: null};
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: theme.bg, padding: 20},
  header: {marginBottom: 16},
  back: {color: theme.muted, fontSize: 15, marginBottom: 6},
  title: {color: '#fff', fontSize: 26, fontWeight: '800'},
  intro: {color: theme.muted, fontSize: 14, marginTop: 8, lineHeight: 20},
  loading: {marginTop: 24},
  error: {color: '#f87171', fontSize: 15, marginTop: 12},
  progress: {color: theme.text, fontSize: 16, fontWeight: '600', marginBottom: 8},
  doneText: {color: '#34d399', fontSize: 16, fontWeight: '700', marginBottom: 8},
  audioPanel: {backgroundColor: theme.surfaceStrong, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.border, padding: 18, marginBottom: 14, alignItems: 'center'},
  audioCount: {color: theme.muted, fontSize: 13, fontVariant: ['tabular-nums']},
  audioLabel: {color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 4, textAlign: 'center'},
  audioPrompt: {color: theme.muted, fontSize: 15, marginTop: 6, marginBottom: 14},
  audioBtns: {flexDirection: 'row', gap: 12},
  audioBtn: {paddingVertical: 12, paddingHorizontal: 36, borderRadius: 999},
  audioYes: {backgroundColor: theme.accent},
  audioNo: {backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: theme.border},
  audioBtnText: {color: '#fff', fontWeight: '700', fontSize: 16},
  list: {paddingBottom: 24},
  row: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border},
  rowLabel: {color: theme.text, fontSize: 14, flexShrink: 1, marginRight: 12},
  rowMark: {color: theme.muted, fontSize: 16, fontWeight: '700'},
  probe: {width: 1, height: 1, opacity: 0, position: 'absolute', bottom: 0, right: 0},
});
