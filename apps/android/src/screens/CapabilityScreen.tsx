import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Video, {type OnLoadData} from 'react-native-video';

import {sampleUrl, type CapabilityProbeOutcome, type ServerSample} from '../api/client';
import {useDevice} from '../context/DeviceContext';
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
  const insets = useSafeAreaInsets();
  const [samples, setSamples] = useState<ServerSample[]>([]);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<Record<string, CapabilityProbeOutcome>>({});
  const [phase, setPhase] = useState<Phase>('loading');
  const settled = useRef(false);

  const base = config?.serverUrl ?? '';

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
    if (phase !== 'probing' || idx >= samples.length) {
      return undefined;
    }
    settled.current = false;
    const sample = samples[idx];
    const t = setTimeout(() => {
      if (!settled.current) {
        settled.current = true;
        record(sample, emptyOutcome(false));
      }
    }, PROBE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [phase, idx, samples]);

  // All samples probed -> report to the backend.
  useEffect(() => {
    if (phase !== 'probing' || samples.length === 0 || idx < samples.length) {
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
  }, [phase, idx, samples]);

  const onLoad = (data: OnLoadData): void => {
    if (settled.current || idx >= samples.length) {
      return;
    }
    settled.current = true;
    record(samples[idx], {
      played: true,
      video_bytes: 0,
      audio_bytes: 0,
      has_audio: (data.audioTracks?.length ?? 0) > 0,
      audio_rms: null,
      cues: null,
    });
  };

  const onError = (): void => {
    if (settled.current || idx >= samples.length) {
      return;
    }
    settled.current = true;
    record(samples[idx], emptyOutcome(false));
  };

  const current = phase === 'probing' && idx < samples.length ? samples[idx] : null;

  return (
    <View style={[styles.root, {paddingTop: insets.top}]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹ Vissza</Text>
        </Pressable>
        <Text style={styles.title}>Képességteszt</Text>
        <Text style={styles.intro}>
          A lejátszó kipróbálja a minta-klipeket, és jelenti a szervernek, mit tud
          natívan lejátszani — ettől függ az eszközre szabott optimalizálás.
        </Text>
      </View>

      {phase === 'loading' && <ActivityIndicator color={theme.accent} style={styles.loading} />}
      {phase === 'error' && <Text style={styles.error}>Hiba a képességteszt során.</Text>}
      {(phase === 'probing' || phase === 'reporting') && (
        <Text style={styles.progress}>
          Tesztelés… {Math.min(idx, samples.length)} / {samples.length}
        </Text>
      )}
      {phase === 'done' && <Text style={styles.doneText}>Kész — a profil elküldve. ✓</Text>}

      <FlatList
        data={samples}
        keyExtractor={s => s.id}
        contentContainerStyle={styles.list}
        renderItem={({item}) => {
          const r = results[item.id];
          return (
            <View style={styles.row}>
              <Text style={styles.rowLabel} numberOfLines={1}>
                {item.label}
              </Text>
              <Text style={styles.rowMark}>
                {r === undefined ? '·' : r.played ? '✓' : '✗'}
              </Text>
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
