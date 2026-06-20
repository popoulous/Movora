import AsyncStorage from '@react-native-async-storage/async-storage';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Video, {
  SelectedTrackType,
  TextTrackType,
  type OnLoadData,
  type OnProgressData,
  type VideoRef,
} from 'react-native-video';

import {Icon} from '../components/Icon';
import {mediaUrl, type Episode, type PlaybackInfo, type SeriesDetail} from '../api/client';
import {useDevice} from '../context/DeviceContext';
import {useI18n, type Key} from '../i18n';
import type {RootStackParamList} from '../navigation';
import {theme} from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Player'>;

// The shape react-native-video's `textTracks` prop expects (its `language` is a strict
// ISO639_1 union); derived from the component so we needn't import the internal type.
type RnTextTrack = NonNullable<React.ComponentProps<typeof Video>['textTracks']>[number];

const SAVE_INTERVAL_S = 10;
const PREPARE_POLL_MS = 4000;
const COUNTDOWN_START = 10;
const CONTROLS_TIMEOUT = 4500;
const AUDIO_PREF_PREFIX = 'movora_audio_pref_'; // + seriesId -> language
const SUB_PREF_KEY = 'movora_sub_pref'; // remembered subtitle language ('off' to disable)
const SUB_STYLE_KEY = 'movora_sub_style';

type SubSize = 's' | 'm' | 'l' | 'xl' | 'xxl' | 'xxxl';
type SubPos = 'low' | 'mid' | 'high';
interface SubStyle {
  size: SubSize;
  pos: SubPos;
}
const SIZES: SubSize[] = ['s', 'm', 'l', 'xl', 'xxl', 'xxxl'];
const POSS: SubPos[] = ['low', 'mid', 'high'];
const SIZE_PX: Record<SubSize, number> = {s: 14, m: 18, l: 24, xl: 31, xxl: 40, xxxl: 50};
const POS_PAD: Record<SubPos, number> = {low: 18, mid: 120, high: 250};
const SIZE_KEY: Record<SubSize, Key> = {
  s: 'player.size_s',
  m: 'player.size_m',
  l: 'player.size_l',
  xl: 'player.size_xl',
  xxl: 'player.size_xxl',
  xxxl: 'player.size_xxxl',
};
const POS_KEY: Record<SubPos, Key> = {
  low: 'player.pos_low',
  mid: 'player.pos_mid',
  high: 'player.pos_high',
};

interface TrackOption {
  index: number;
  label: string;
  language: string | null;
}

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) {
    return '0:00';
  }
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return (h > 0 ? `${h}:` : '') + `${mm}:${String(s).padStart(2, '0')}`;
}

export default function PlayerScreen({navigation, route}: Props): React.JSX.Element {
  const {api, config} = useDevice();
  const {t} = useI18n();
  const {episodeId} = route.params;
  const videoRef = useRef<VideoRef>(null);
  const lastSaved = useRef(0);
  const cdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [info, setInfo] = useState<PlaybackInfo | null>(null);
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioTracks, setAudioTracks] = useState<TrackOption[]>([]);
  const [audioIndex, setAudioIndex] = useState<number>(-1);
  const [textIndex, setTextIndex] = useState<number>(-1); // -1 = off
  const [picker, setPicker] = useState<'audio' | 'text' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [subStyle, setSubStyle] = useState<SubStyle>({size: 'm', pos: 'low'});
  const [skip, setSkip] = useState<'intro' | 'outro' | null>(null);
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_START);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);

  const base = config?.serverUrl ?? '';
  const token = config?.deviceToken ?? null;

  // Refs that PanResponder (created once) reads to avoid stale closures.
  const barWRef = useRef(0);
  const durRef = useRef(0);
  const pausedRef = useRef(false);
  useEffect(() => {
    durRef.current = duration;
  }, [duration]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const armHide = (): void => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }
    hideTimer.current = setTimeout(() => {
      if (!pausedRef.current) {
        setControlsVisible(false);
      }
    }, CONTROLS_TIMEOUT);
  };

  const showControls = (): void => {
    setControlsVisible(true);
    armHide();
  };

  const toggleControls = (): void => {
    if (controlsVisible) {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }
      setControlsVisible(false);
    } else {
      showControls();
    }
  };

  // Wrap a control action so it keeps the overlay alive afterwards.
  const act = (fn: () => void) => (): void => {
    fn();
    armHide();
  };

  useEffect(() => {
    AsyncStorage.getItem(SUB_STYLE_KEY).then(v => {
      if (!v) {
        return;
      }
      try {
        const parsed = JSON.parse(v) as Partial<SubStyle>;
        setSubStyle(s => ({
          size: parsed.size && SIZES.includes(parsed.size) ? parsed.size : s.size,
          pos: parsed.pos && POSS.includes(parsed.pos) ? parsed.pos : s.pos,
        }));
      } catch {
        /* ignore */
      }
    });
  }, []);

  useEffect(() => {
    armHide();
    return () => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }
    };
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
    lastSaved.current = 0;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, episodeId]);

  // Apply the remembered subtitle language whenever a new episode loads.
  useEffect(() => {
    if (!info) {
      return;
    }
    AsyncStorage.getItem(SUB_PREF_KEY).then(pref => {
      const tracks = info.subtitle_tracks ?? [];
      if (!pref || pref === 'off') {
        setTextIndex(-1);
        return;
      }
      const idx = tracks.findIndex(tr => (tr.language ?? '') === pref || tr.label === pref);
      setTextIndex(idx);
    });
  }, [info]);

  // Neighbouring episodes for prev/next + auto-advance.
  const flat: Episode[] = useMemo(
    () => (series ? series.seasons.flatMap(s => s.episodes) : []),
    [series],
  );
  const curIdx = flat.findIndex(e => e.id === episodeId);
  const prevId = curIdx > 0 ? flat[curIdx - 1].id : null;
  const nextId = curIdx >= 0 && curIdx + 1 < flat.length ? flat[curIdx + 1].id : null;

  const textTracks = useMemo<RnTextTrack[]>(
    () =>
      (info?.subtitle_tracks ?? []).map(tr => ({
        title: tr.label,
        language: (tr.language ?? 'und') as RnTextTrack['language'],
        type: TextTrackType.VTT,
        uri: mediaUrl(base, token, tr.format === 'ass' ? `${tr.url}&as=vtt` : tr.url) ?? '',
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
    setDuration(data.duration);
    if (info && info.resume_position > 5) {
      videoRef.current?.seek(info.resume_position);
    }
    const tracks: TrackOption[] = (data.audioTracks ?? []).map((tr, i) => ({
      index: tr.index ?? i,
      label: tr.title || tr.language || `#${i + 1}`,
      language: tr.language ?? null,
    }));
    setAudioTracks(tracks);
    if (info) {
      void applyRememberedAudio(info.series_id, tracks);
    }
  };

  const applyRememberedAudio = async (seriesId: number, tracks: TrackOption[]): Promise<void> => {
    const pref = await AsyncStorage.getItem(AUDIO_PREF_PREFIX + seriesId);
    const match = pref ? tracks.findIndex(tr => tr.language === pref) : -1;
    setAudioIndex(match >= 0 ? tracks[match].index : tracks[0]?.index ?? -1);
  };

  const chooseAudio = (opt: TrackOption): void => {
    setAudioIndex(opt.index);
    setPicker(null);
    if (info) {
      void AsyncStorage.setItem(AUDIO_PREF_PREFIX + info.series_id, opt.language ?? '');
    }
  };

  const chooseText = (opt: TrackOption): void => {
    setTextIndex(opt.index);
    setPicker(null);
    const lang = textTracks[opt.index]?.language as string | undefined;
    void AsyncStorage.setItem(SUB_PREF_KEY, lang && lang !== 'und' ? lang : opt.label);
  };

  const turnOffText = (): void => {
    setTextIndex(-1);
    setPicker(null);
    void AsyncStorage.setItem(SUB_PREF_KEY, 'off');
  };

  const setSize = (size: SubSize): void => {
    setSubStyle(s => {
      const next = {...s, size};
      void AsyncStorage.setItem(SUB_STYLE_KEY, JSON.stringify(next));
      return next;
    });
  };
  const setPos = (pos: SubPos): void => {
    setSubStyle(s => {
      const next = {...s, pos};
      void AsyncStorage.setItem(SUB_STYLE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const onProgress = (data: OnProgressData): void => {
    const pos = data.currentTime;
    if (!scrubbing) {
      setCurrent(pos);
    }
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

  const saveAndBack = (): void => {
    if (api && videoRef.current && current > 0) {
      void api.recordWatch(episodeId, {position_seconds: current});
    }
    navigation.goBack();
  };

  const onEnd = (): void => {
    if (api) {
      void api.recordWatch(episodeId, {watched: true});
    }
    setEnded(true);
  };

  // Scrubber: a tap or drag anywhere on the bar seeks proportionally.
  const seekFromX = (x: number): number => {
    const w = barWRef.current;
    if (w <= 0 || durRef.current <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(1, x / w)) * durRef.current;
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: e => {
        setControlsVisible(true);
        if (hideTimer.current) {
          clearTimeout(hideTimer.current);
        }
        setScrubbing(true);
        setScrubValue(seekFromX(e.nativeEvent.locationX));
      },
      onPanResponderMove: e => setScrubValue(seekFromX(e.nativeEvent.locationX)),
      onPanResponderRelease: e => {
        const target = seekFromX(e.nativeEvent.locationX);
        videoRef.current?.seek(target);
        setScrubValue(target);
        setCurrent(target);
        setScrubbing(false);
        armHide();
      },
    }),
  ).current;

  const streamUrl = info ? mediaUrl(base, token, info.stream_url) : undefined;

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <Pressable style={styles.pill} onPress={() => navigation.goBack()}>
          <Text style={styles.pillText}>‹ {t('common.back')}</Text>
        </Pressable>
      </View>
    );
  }
  if (preparing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.accent} />
        <Text style={styles.prep}>{t('player.optimizing', {percent: info?.prepare_progress ?? 0})}</Text>
        <Pressable style={styles.pill} onPress={() => navigation.goBack()}>
          <Text style={styles.pillText}>‹ {t('common.back')}</Text>
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

  const displayPos = scrubbing ? scrubValue : current;
  const pct = duration > 0 ? (displayPos / duration) * 100 : 0;

  return (
    <View style={styles.root}>
      <Video
        ref={videoRef}
        source={{uri: streamUrl}}
        style={styles.video}
        paused={paused}
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
        subtitleStyle={{fontSize: SIZE_PX[subStyle.size], paddingBottom: POS_PAD[subStyle.pos]}}
        onLoad={onLoad}
        onProgress={onProgress}
        onEnd={onEnd}
        onError={() => setError(t('player.error'))}
      />

      {/* Tap layer: toggles the controls overlay. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={toggleControls} />

      {/* Skip intro/outro chip — available whether or not the overlay is open. */}
      {skip !== null && !ended && (
        <Pressable style={styles.skip} onPress={act(doSkip)}>
          <LinearGradient
            colors={theme.gradient}
            start={{x: 0, y: 0}}
            end={{x: 1, y: 1}}
            style={StyleSheet.absoluteFill}
          />
          <Icon name="skip" size={18} color="#fff" />
          <Text style={styles.skipText}>
            {skip === 'intro' ? t('player.skipIntro') : t('player.nextEpisode')}
          </Text>
        </Pressable>
      )}

      {controlsVisible && !ended && (
        <View style={styles.overlay} pointerEvents="box-none">
          {/* Top bar: back */}
          <View style={styles.topBar} pointerEvents="box-none">
            <Pressable style={styles.backBtn} onPress={saveAndBack} onFocus={showControls}>
              <Icon name="back" size={22} color="#fff" />
              <Text style={styles.backLabel}>{t('common.back')}</Text>
            </Pressable>
          </View>

          {/* Bottom panel */}
          <LinearGradient
            colors={['transparent', 'rgba(5,6,11,0.55)', 'rgba(5,6,11,0.97)']}
            style={styles.panel}
            pointerEvents="box-none">
            <Text style={styles.title} numberOfLines={1}>
              {info.series_title}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {t('series.episode', {number: info.episode_number})}
              {info.episode_title ? ` — ${info.episode_title}` : ''}
            </Text>

            {/* Scrubber */}
            <View style={styles.scrubRow}>
              <Text style={styles.time}>{fmt(displayPos)}</Text>
              <View
                style={styles.barHit}
                onLayout={e => (barWRef.current = e.nativeEvent.layout.width)}
                {...pan.panHandlers}>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, {width: `${pct}%`}]} />
                  <View style={[styles.barThumb, {left: `${pct}%`}]} />
                </View>
              </View>
              <Text style={styles.time}>{fmt(duration)}</Text>
            </View>

            {/* Transport */}
            <View style={styles.transport}>
              {textTracks.length > 0 && (
                <CtrlButton icon="subtitles" on={textIndex >= 0} onPress={act(() => setPicker('text'))} />
              )}
              {audioTracks.length > 1 && (
                <CtrlButton icon="audio" onPress={act(() => setPicker('audio'))} />
              )}
              {prevId != null && <CtrlButton icon="prev" onPress={act(() => goTo(prevId))} />}
              <CtrlButton icon={paused ? 'play' : 'pause'} big onPress={act(() => setPaused(p => !p))} />
              {nextId != null && <CtrlButton icon="next" onPress={act(() => goTo(nextId))} />}
              <CtrlButton icon="settings" onPress={act(() => setSettingsOpen(true))} />
            </View>

            {/* Episode strip */}
            {flat.length > 1 && (
              <>
                <Text style={styles.stripLabel}>{t('player.episodes')}</Text>
                <FlatList
                  data={flat}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={ep => String(ep.id)}
                  initialScrollIndex={curIdx >= 0 ? curIdx : 0}
                  getItemLayout={(_, index) => ({length: 166, offset: 166 * index, index})}
                  onScrollToIndexFailed={() => undefined}
                  renderItem={({item: ep}) => (
                    <EpisodeCard
                      ep={ep}
                      current={ep.id === episodeId}
                      thumb={mediaUrl(base, token, ep.thumbnail_url)}
                      label={
                        ep.end_number != null
                          ? t('series.episodeRange', {from: ep.number, to: ep.end_number})
                          : t('series.episode', {number: ep.number})
                      }
                      onPress={() => (ep.id === episodeId ? toggleControls() : goTo(ep.id))}
                    />
                  )}
                />
              </>
            )}
          </LinearGradient>
        </View>
      )}

      {/* Ended overlay */}
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
              <Pressable style={styles.pill} onPress={() => setEnded(false)}>
                <Text style={styles.pillText}>{t('player.cancel')}</Text>
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
        onPick={chooseText}
        onOff={turnOffText}
        onClose={() => setPicker(null)}
      />

      <SubtitleSettings
        visible={settingsOpen}
        style={subStyle}
        onSize={setSize}
        onPos={setPos}
        onClose={() => {
          setSettingsOpen(false);
          armHide();
        }}
        t={t}
      />
    </View>
  );
}

// A focusable, circular transport button (touch + Android TV D-pad).
function CtrlButton({
  icon,
  big,
  on,
  onPress,
}: {
  icon: string;
  big?: boolean;
  on?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  const size = big ? 60 : 48;
  const iconColor = focused ? '#fff' : on ? theme.accent : '#e9e9f2';
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.ctrl,
        {width: size, height: size, borderRadius: size / 2},
        focused && styles.ctrlFocused,
      ]}>
      {focused && (
        <LinearGradient
          colors={theme.gradient}
          start={{x: 0, y: 0}}
          end={{x: 1, y: 1}}
          style={[StyleSheet.absoluteFill, {borderRadius: size / 2}]}
        />
      )}
      <Icon name={icon} size={big ? 28 : 22} color={iconColor} />
    </Pressable>
  );
}

function EpisodeCard({
  ep,
  current,
  thumb,
  label,
  onPress,
}: {
  ep: Episode;
  current: boolean;
  thumb: string | undefined;
  label: string;
  onPress: () => void;
}): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.epCard,
        current && styles.epCardCurrent,
        focused && styles.epCardFocused,
      ]}>
      {thumb ? (
        <Image source={{uri: thumb}} style={styles.epThumb} />
      ) : (
        <View style={[styles.epThumb, styles.epThumbEmpty]} />
      )}
      <Text style={[styles.epLabel, ep.watched && styles.epWatched]} numberOfLines={1}>
        {label}
        {current ? ' ●' : ''}
        {ep.watched ? ' ✓' : ''}
      </Text>
      {ep.title ? (
        <Text style={styles.epTitle} numberOfLines={1}>
          {ep.title}
        </Text>
      ) : null}
    </Pressable>
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
                {offLabel ?? 'Off'}
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

function SubtitleSettings({
  visible,
  style,
  onSize,
  onPos,
  onClose,
  t,
}: {
  visible: boolean;
  style: SubStyle;
  onSize: (s: SubSize) => void;
  onPos: (p: SubPos) => void;
  onClose: () => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
}): React.JSX.Element {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{t('player.subtitleSettings')}</Text>

          <Text style={styles.settingLabel}>{t('player.size')}</Text>
          <View style={styles.pillRow}>
            {SIZES.map(s => (
              <Pressable
                key={s}
                onPress={() => onSize(s)}
                style={[styles.choice, style.size === s && styles.choiceActive]}>
                <Text style={[styles.choiceText, style.size === s && styles.choiceTextActive]}>
                  {t(SIZE_KEY[s])}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.settingLabel}>{t('player.position')}</Text>
          <View style={styles.pillRow}>
            {POSS.map(p => (
              <Pressable
                key={p}
                onPress={() => onPos(p)}
                style={[styles.choice, style.pos === p && styles.choiceActive]}>
                <Text style={[styles.choiceText, style.pos === p && styles.choiceTextActive]}>
                  {t(POS_KEY[p])}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000'},
  video: {...StyleSheet.absoluteFillObject, backgroundColor: '#000'},
  center: {flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24},
  error: {color: '#f87171', fontSize: 16, textAlign: 'center'},
  prep: {color: theme.text, fontSize: 16},
  pill: {paddingVertical: 10, paddingHorizontal: 20, backgroundColor: theme.surfaceStrong, borderRadius: 999},
  pillText: {color: theme.text, fontSize: 15},

  overlay: {...StyleSheet.absoluteFillObject, justifyContent: 'space-between'},
  topBar: {flexDirection: 'row', padding: 14},
  backBtn: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.35)'},
  backLabel: {color: '#fff', fontSize: 15, fontWeight: '600'},

  panel: {paddingHorizontal: 24, paddingTop: 40, paddingBottom: 20},
  title: {color: '#fff', fontSize: 20, fontWeight: '800'},
  meta: {color: theme.muted, fontSize: 14, marginTop: 2, marginBottom: 12},

  scrubRow: {flexDirection: 'row', alignItems: 'center', marginBottom: 10},
  time: {color: '#fff', fontSize: 13, width: 56, textAlign: 'center', fontVariant: ['tabular-nums']},
  barHit: {flex: 1, paddingVertical: 12, justifyContent: 'center'},
  barTrack: {height: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.25)'},
  barFill: {position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 999, backgroundColor: theme.accent},
  barThumb: {position: 'absolute', top: '50%', width: 16, height: 16, borderRadius: 8, marginLeft: -8, marginTop: -8, backgroundColor: '#fff'},

  transport: {flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginVertical: 6},
  ctrl: {marginHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.18)', overflow: 'hidden'},
  ctrlFocused: {borderColor: 'transparent'},

  stripLabel: {color: '#fff', fontSize: 14, fontWeight: '700', marginTop: 12, marginBottom: 8},
  epCard: {width: 150, marginRight: 16, borderRadius: theme.radius, backgroundColor: theme.surface, borderWidth: 3, borderColor: 'transparent', overflow: 'hidden'},
  epCardCurrent: {borderColor: 'rgba(122,77,255,0.5)'},
  epCardFocused: {borderColor: theme.accent},
  epThumb: {width: '100%', height: 84},
  epThumbEmpty: {backgroundColor: '#11131f'},
  epLabel: {color: theme.text, fontSize: 13, fontWeight: '600', paddingHorizontal: 8, paddingTop: 6},
  epWatched: {color: theme.muted},
  epTitle: {color: theme.muted, fontSize: 11, paddingHorizontal: 8, paddingBottom: 8, paddingTop: 2},

  skip: {position: 'absolute', right: 24, bottom: 110, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 999, overflow: 'hidden'},
  skipText: {color: '#fff', fontWeight: '700', fontSize: 15},

  endedOverlay: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,6,11,0.85)', alignItems: 'center', justifyContent: 'center', gap: 14},
  endedTitle: {color: '#fff', fontSize: 24, fontWeight: '800'},
  endedSub: {color: theme.muted, fontSize: 16},
  endedRow: {flexDirection: 'row', gap: 12, marginTop: 8},
  endedBtn: {backgroundColor: theme.accent, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 26},
  endedBtnText: {color: '#fff', fontWeight: '700', fontSize: 16},

  backdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end'},
  sheet: {backgroundColor: '#0C0E19', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, maxHeight: '70%'},
  sheetTitle: {color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 12},
  option: {paddingVertical: 14},
  optionText: {color: theme.muted, fontSize: 16},
  optionActive: {color: theme.accent, fontWeight: '700'},
  settingLabel: {color: theme.muted, fontSize: 14, marginTop: 12, marginBottom: 8},
  pillRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  choice: {paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)'},
  choiceActive: {backgroundColor: theme.accent},
  choiceText: {color: theme.muted, fontSize: 14, fontWeight: '600'},
  choiceTextActive: {color: '#fff'},
});
