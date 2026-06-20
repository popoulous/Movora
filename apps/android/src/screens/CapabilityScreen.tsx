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

type Phase = 'loading' | 'probing' | 'reporting' | 'done' | 'error';

const PROBE_TIMEOUT_MS = 8000;

// Real playback probe: play each sample clip and record whether it decodes (and whether
// audio is present), then report the profile so the backend's CompatibilitySelector knows
// what this device can Direct Play. Mirrors apps/webos, adapted to react-native-video.
export default function CapabilityScreen({navigation}: Props): React.JSX.Element {
  const {api, config} = useDevice();
  const {t} = useI18n();
  const insets = useSafeAreaInsets();
  const [samples, setSamples] = useState<ServerSample[]>([]);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<Record<string, CapabilityProbeOutcome>>({});
  const [phase, setPhase] = useState<Phase>('loading');
  const settled = useRef(false);

  const base = config?.serverUrl ?? '';

  // Subtitle samples are plain .vtt/.srt/.ass files — they can't be "played" by the video
  // element, and the backend derives subtitle support from the explicit supports_* flags
  // below (not the probe), so we only video-probe the video/container/audio samples.
  const probeable = useMemo(() => samples.filter(s => s.category !== 'subtitle'), [samples]);

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
    setIdx(i => i + 1);
  };

  // Per-sample timeout: a clip that never loads or errors counts as not played.
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
      }
    }, PROBE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase, idx, probeable]);

  // All samples probed -> report to the backend.
  useEffect(() => {
    if (phase !== 'probing' || idx < probeable.length) {
      return;
    }
    setPhase('reporting');
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
  };

  const onError = (): void => {
    if (settled.current || idx >= probeable.length) {
      return;
    }
    settled.current = true;
    record(probeable[idx], emptyOutcome(false));
  };

  const current = phase === 'probing' && idx < probeable.length ? probeable[idx] : null;

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

      <FlatList
        data={samples}
        keyExtractor={s => s.id}
        contentContainerStyle={styles.list}
        renderItem={({item}) => {
          const r = results[item.id];
          // Subtitles aren't video-probed: ExoPlayer renders VTT/SRT natively, and we
          // serve ASS converted to VTT — so all three are effectively supported.
          const mark =
            item.category === 'subtitle'
              ? item.id.startsWith('ass')
                ? '→VTT'
                : '✓'
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

      {/* Off-screen prober: one clip at a time. */}
      {current && (
        <Video
          key={current.id}
          source={{uri: sampleUrl(base, current.id)}}
          style={styles.probe}
          muted
          paused={false}
          onLoad={onLoad}
          onError={onError}
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
  list: {paddingBottom: 24},
  row: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border},
  rowLabel: {color: theme.text, fontSize: 14, flexShrink: 1, marginRight: 12},
  rowMark: {color: theme.muted, fontSize: 16, fontWeight: '700'},
  probe: {width: 1, height: 1, opacity: 0, position: 'absolute', bottom: 0, right: 0},
});
