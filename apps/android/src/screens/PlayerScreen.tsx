import AsyncStorage from '@react-native-async-storage/async-storage';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Video, {
  SelectedTrackType,
  TextTrackType,
  type OnLoadData,
  type OnProgressData,
  type VideoRef,
} from 'react-native-video';

import {mediaUrl, type Episode, type PlaybackInfo, type SeriesDetail} from '../api/client';
import {useDevice} from '../context/DeviceContext';
import {useI18n} from '../i18n';
import type {RootStackParamList} from '../navigation';
import {theme} from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Player'>;

// The shape react-native-video's `textTracks` prop expects (its `language` is a strict
// ISO639_1 union); derived from the component so we needn't import the internal type.
type RnTextTrack = NonNullable<React.ComponentProps<typeof Video>['textTracks']>[number];

const SAVE_INTERVAL_S = 10;
const PREPARE_POLL_MS = 4000;
const COUNTDOWN_START = 10;
const AUDIO_PREF_PREFIX = 'movora_audio_pref_'; // + seriesId -> language
const SUB_SIZE_KEY = 'movora_sub_size';

type SubSize = 's' | 'm' | 'l';
const SIZE_PX: Record<SubSize, number> = {s: 16, m: 22, l: 30};
const SIZES: SubSize[] = ['s', 'm', 'l'];

interface TrackOption {
  index: number;
  label: string;
  language: string | null;
}

export default function PlayerScreen({navigation, route}: Props): React.JSX.Element {
  const {api, config} = useDevice();
  const {t} = useI18n();
  const {episodeId} = route.params;
  const videoRef = useRef<VideoRef>(null);
  const lastSaved = useRef(0);
  const cdTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [info, setInfo] = useState<PlaybackInfo | null>(null);
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [audioTracks, setAudioTracks] = useState<TrackOption[]>([]);
  const [audioIndex, setAudioIndex] = useState<number>(-1);
  const [textIndex, setTextIndex] = useState<number>(-1); // -1 = off
  const [picker, setPicker] = useState<'audio' | 'text' | null>(null);
  const [subSize, setSubSize] = useState<SubSize>('m');
  const [skip, setSkip] = useState<'intro' | 'outro' | null>(null);
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_START);

  const base = config?.serverUrl ?? '';
  const token = config?.deviceToken ?? null;

  useEffect(() => {
    AsyncStorage.getItem(SUB_SIZE_KEY).then(v => {
      if (v === 's' || v === 'm' || v === 'l') {
        setSubSize(v);
      }
    });
  }, []);

  // Load playback info; if a device variant is still building, poll until it's ready.
  useEffect(() => {
    if (!api) {
      return undefined;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setEnded(false);
    setSkip(null);
    const load = (): void => {
      api
        .getPlayback(episodeId)
        .then(i => {
          if (cancelled) {
            return;
          }
          if (i.variant_status === 'preparing') {
            setPreparing(true);
            setInfo(i);
            timer = setTimeout(load, PREPARE_POLL_MS);
            return;
          }
          setPreparing(false);
          setInfo(i);
          setError(i.variant_status === 'unavailable' ? t('player.unavailable') : null);
          api.getSeries(i.series_id).then(setSeries).catch(() => undefined);
        })
        .catch((e: unknown) => !cancelled && setError(String(e)));
    };
    load();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [api, episodeId]);

  // Neighbouring episodes for prev/next + auto-advance.
  const {prevId, nextId} = useMemo(() => {
    const flat: Episode[] = series ? series.seasons.flatMap(s => s.episodes) : [];
    const idx = flat.findIndex(e => e.id === episodeId);
    return {
      prevId: idx > 0 ? flat[idx - 1].id : null,
      nextId: idx >= 0 && idx + 1 < flat.length ? flat[idx + 1].id : null,
    };
  }, [series, episodeId]);

  const textTracks = useMemo<RnTextTrack[]>(
    () =>
      (info?.subtitle_tracks ?? []).map(t => ({
        title: t.label,
        language: (t.language ?? 'und') as RnTextTrack['language'],
        type: TextTrackType.VTT,
        uri: mediaUrl(base, token, t.format === 'ass' ? `${t.url}&as=vtt` : t.url) ?? '',
      })),
    [info, base, token],
  );

  // Countdown to auto-advance once the episode ends.
  useEffect(() => {
    if (!ended) {
      return undefined;
    }
    setCountdown(COUNTDOWN_START);
    cdTimer.current = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => {
      if (cdTimer.current) {
        clearInterval(cdTimer.current);
      }
    };
  }, [ended]);

  useEffect(() => {
    if (ended && countdown === 0) {
      goNext();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended, countdown]);

  const onLoad = (data: OnLoadData): void => {
    if (info && info.resume_position > 5) {
      videoRef.current?.seek(info.resume_position);
    }
    const tracks: TrackOption[] = (data.audioTracks ?? []).map((t, i) => ({
      index: t.index ?? i,
      label: t.title || t.language || `#${i + 1}`,
      language: t.language ?? null,
    }));
    setAudioTracks(tracks);
    if (info) {
      void applyRememberedAudio(info.series_id, tracks);
    }
  };

  const applyRememberedAudio = async (seriesId: number, tracks: TrackOption[]): Promise<void> => {
    const pref = await AsyncStorage.getItem(AUDIO_PREF_PREFIX + seriesId);
    const match = pref ? tracks.findIndex(t => t.language === pref) : -1;
    setAudioIndex(match >= 0 ? tracks[match].index : tracks[0]?.index ?? -1);
  };

  const chooseAudio = (opt: TrackOption): void => {
    setAudioIndex(opt.index);
    setPicker(null);
    if (info) {
      void AsyncStorage.setItem(AUDIO_PREF_PREFIX + info.series_id, opt.language ?? '');
    }
  };

  const cycleSize = (): void => {
    const next = SIZES[(SIZES.indexOf(subSize) + 1) % SIZES.length];
    setSubSize(next);
    void AsyncStorage.setItem(SUB_SIZE_KEY, next);
  };

  const onProgress = (data: OnProgressData): void => {
    const pos = data.currentTime;
    if (info) {
      if (info.intro_start != null && info.intro_end != null && pos >= info.intro_start && pos < info.intro_end) {
        setSkip('intro');
      } else if (info.outro_start != null && pos >= info.outro_start) {
        setSkip('outro');
      } else {
        setSkip(null);
      }
    }
    if (api && pos - lastSaved.current >= SAVE_INTERVAL_S) {
      lastSaved.current = pos;
      void api.recordWatch(episodeId, {position_seconds: pos});
    }
  };

  const doSkip = (): void => {
    if (skip === 'intro' && info?.intro_end != null) {
      videoRef.current?.seek(info.intro_end);
      setSkip(null);
    } else if (skip === 'outro') {
      goNext();
    }
  };

  const goTo = (id: number | null): void => {
    if (id != null) {
      navigation.replace('Player', {episodeId: id});
    }
  };

  const goNext = (): void => {
    if (nextId != null) {
      goTo(nextId);
    } else {
      navigation.goBack();
    }
  };

  const onEnd = (): void => {
    if (api) {
      void api.recordWatch(episodeId, {watched: true});
    }
    setEnded(true);
  };

  const streamUrl = info ? mediaUrl(base, token, info.stream_url) : undefined;

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>‹ {t('common.back')}</Text>
        </Pressable>
      </View>
    );
  }
  if (preparing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.accent} />
        <Text style={styles.prep}>{t('player.optimizing', {percent: info?.prepare_progress ?? 0})}</Text>
        <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>‹ {t('common.back')}</Text>
        </Pressable>
      </View>
    );
  }
  if (!info || !streamUrl) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Video
        ref={videoRef}
        source={{uri: streamUrl}}
        style={styles.video}
        controls
        resizeMode="contain"
        selectedAudioTrack={
          audioIndex >= 0 ? {type: SelectedTrackType.INDEX, value: audioIndex} : undefined
        }
        selectedTextTrack={
          textIndex >= 0
            ? {type: SelectedTrackType.INDEX, value: textIndex}
            : {type: SelectedTrackType.DISABLED}
        }
        textTracks={textTracks}
        subtitleStyle={{fontSize: SIZE_PX[subSize], paddingBottom: 24}}
        onLoad={onLoad}
        onProgress={onProgress}
        onEnd={onEnd}
        onError={() => setError(t('player.error'))}
      />

      <View style={styles.topBar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.topItem}>‹ Vissza</Text>
        </Pressable>
        <View style={styles.topRight}>
          {prevId != null && (
            <Pressable onPress={() => goTo(prevId)} hitSlop={12}>
              <Text style={styles.topItem}>⏮ {t('player.prev')}</Text>
            </Pressable>
          )}
          {audioTracks.length > 1 && (
            <Pressable onPress={() => setPicker('audio')} hitSlop={12}>
              <Text style={styles.topItem}>{t('player.audio')}</Text>
            </Pressable>
          )}
          {textTracks.length > 0 && (
            <>
              <Pressable onPress={() => setPicker('text')} hitSlop={12}>
                <Text style={styles.topItem}>{t('player.subtitles')}</Text>
              </Pressable>
              <Pressable onPress={cycleSize} hitSlop={12}>
                <Text style={styles.topItem}>{t('player.size', {size: subSize.toUpperCase()})}</Text>
              </Pressable>
            </>
          )}
          {nextId != null && (
            <Pressable onPress={() => goTo(nextId)} hitSlop={12}>
              <Text style={styles.topItem}>{t('player.next')} ⏭</Text>
            </Pressable>
          )}
        </View>
      </View>

      {skip !== null && !ended && (
        <Pressable style={styles.skip} onPress={doSkip}>
          <Text style={styles.skipText}>
            {skip === 'intro' ? t('player.skipIntro') : t('player.nextEpisode')} ⏭
          </Text>
        </Pressable>
      )}

      {ended && (
        <View style={styles.endedOverlay}>
          <Text style={styles.endedTitle}>{t('player.ended')}</Text>
          <Text style={styles.endedSub}>
            {nextId != null
              ? t('player.nextIn', {seconds: countdown})
              : t('player.backIn', {seconds: countdown})}
          </Text>
          <View style={styles.endedRow}>
            <Pressable style={styles.endedBtn} onPress={goNext}>
              <Text style={styles.endedBtnText}>
                {nextId != null ? t('player.playNow') : t('common.back')}
              </Text>
            </Pressable>
            {nextId != null && (
              <Pressable style={styles.endedCancel} onPress={() => setEnded(false)}>
                <Text style={styles.backText}>{t('player.cancel')}</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      <TrackPicker
        visible={picker === 'audio'}
        title={t('player.audioTrack')}
        options={audioTracks}
        selected={audioIndex}
        onPick={chooseAudio}
        onClose={() => setPicker(null)}
      />
      <TrackPicker
        visible={picker === 'text'}
        title={t('player.subtitleTrack')}
        options={textTracks.map((track, i) => ({
          index: i,
          label: track.title,
          language: track.language ?? null,
        }))}
        selected={textIndex}
        offLabel={t('player.subtitlesOff')}
        onPick={opt => {
          setTextIndex(opt.index);
          setPicker(null);
        }}
        onOff={() => {
          setTextIndex(-1);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}

function TrackPicker({
  visible,
  title,
  options,
  selected,
  offLabel,
  onPick,
  onOff,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: TrackOption[];
  selected: number;
  offLabel?: string;
  onPick: (opt: TrackOption) => void;
  onOff?: () => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{title}</Text>
          {onOff ? (
            <Pressable style={styles.option} onPress={onOff}>
              <Text style={[styles.optionText, selected < 0 && styles.optionActive]}>
                {offLabel ?? 'Kikapcsolva'}
              </Text>
            </Pressable>
          ) : null}
          <FlatList
            data={options}
            keyExtractor={o => String(o.index)}
            renderItem={({item}) => (
              <Pressable style={styles.option} onPress={() => onPick(item)}>
                <Text style={[styles.optionText, selected === item.index && styles.optionActive]}>
                  {item.label}
                </Text>
              </Pressable>
            )}
          />
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000'},
  video: {flex: 1, backgroundColor: '#000'},
  center: {flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24},
  error: {color: '#f87171', fontSize: 16, textAlign: 'center'},
  prep: {color: theme.text, fontSize: 16},
  backBtn: {paddingVertical: 10, paddingHorizontal: 20, backgroundColor: theme.surface, borderRadius: 999},
  backText: {color: theme.text, fontSize: 15},
  topBar: {position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', padding: 16},
  topRight: {flexDirection: 'row', gap: 18, flexWrap: 'wrap'},
  topItem: {color: '#fff', fontSize: 15, fontWeight: '600', textShadowColor: '#000', textShadowRadius: 4},
  skip: {position: 'absolute', right: 24, bottom: 90, backgroundColor: theme.accent, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 22},
  skipText: {color: '#fff', fontWeight: '700', fontSize: 15},
  endedOverlay: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(5,6,11,0.85)', alignItems: 'center', justifyContent: 'center', gap: 14},
  endedTitle: {color: '#fff', fontSize: 24, fontWeight: '800'},
  endedSub: {color: theme.muted, fontSize: 16},
  endedRow: {flexDirection: 'row', gap: 12, marginTop: 8},
  endedBtn: {backgroundColor: theme.accent, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 26},
  endedBtnText: {color: '#fff', fontWeight: '700', fontSize: 16},
  endedCancel: {backgroundColor: theme.surface, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 22},
  backdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end'},
  sheet: {backgroundColor: '#0C0E19', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, maxHeight: '60%'},
  sheetTitle: {color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 12},
  option: {paddingVertical: 14},
  optionText: {color: theme.muted, fontSize: 16},
  optionActive: {color: theme.accent, fontWeight: '700'},
});
