import AsyncStorage from '@react-native-async-storage/async-storage';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  type GestureResponderEvent,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import SystemNavigationBar from 'react-native-system-navigation-bar';
import Video, {
  BufferingStrategyType,
  SelectedTrackType,
  type OnLoadData,
  type OnProgressData,
  type OnSeekData,
  type VideoRef,
} from 'react-native-video';

import {Icon} from '../components/Icon';
import {mediaUrl, type Episode, type PlaybackInfo, type SeriesDetail} from '../api/client';
import {useDevice} from '../context/DeviceContext';
import {useI18n, type Key} from '../i18n';
import type {RootStackParamList} from '../navigation';
import {theme} from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Player'>;

const SAVE_INTERVAL_S = 10;
const SKIP_LANDING_MARGIN_S = 0.75; // skip lands a beat past the marker, never inside it
const PREPARE_POLL_MS = 4000;
const COUNTDOWN_START = 10;
const CONTROLS_TIMEOUT = 4500;
// While a seek is in flight onProgress still reports the *old* position for a beat
// (slow NAS sources buffer for a while). Treat the seek as landed once playback is
// within this window of the target, so the progress bar doesn't snap back meanwhile.
const SEEK_SETTLE_S = 1.5;
// Give a slow remote (NAS) source more runway: a bigger forward buffer rebuffers
// less violently, and a back-buffer keeps short rewinds instant instead of refetching.
// maxHeapAllocationPercent caps the ExoPlayer byte buffer at ~half the app's heap
// class; without it a high-bitrate Direct-Play MKV fills the Java heap until the app
// OOM-crashes mid-playback. It is only enforced together with bufferingStrategy
// DependingOnMemory (set on the <Video> below) — the default strategy ignores it.
const BUFFER_CONFIG = {
  minBufferMs: 15000,
  maxBufferMs: 60000,
  bufferForPlaybackMs: 2500,
  bufferForPlaybackAfterRebufferMs: 5000,
  backBufferDurationMs: 30000,
  // Measured: a 256 MB heap-class device plateaus ~75 MB under the OOM ceiling at
  // this fraction (vs. ~35 MB at 0.5), while still buffering ~90 MB ahead.
  maxHeapAllocationPercent: 0.35,
} as const;
// Double-tap the left/right third of the frame to jump ∓15s (taps chain). A single tap
// only toggles the controls, so it is deferred briefly to let a double tap pre-empt it.
const DOUBLE_TAP_MS = 250;
const SEEK_STEP_S = 15;
// These rips rarely carry authored outro chapters (backend intro.py detects the outro
// chapter-only), so surface a "next episode" prompt over the closing window regardless.
const NEXT_EPISODE_WINDOW_S = 75;
const AUDIO_PREF_PREFIX = 'movora_audio_pref_'; // + seriesId -> language
const SUB_PREF_KEY = 'movora_sub_pref'; // remembered subtitle language ('off' to disable)
const SUB_STYLE_KEY = 'movora_sub_style';

type SubSize = 's' | 'm' | 'l' | 'xl' | 'xxl' | 'xxxl';
type SubBg = 'none' | 'box' | 'solid';
type SubPos = 'low' | 'mid' | 'high';
interface SubStyle {
  size: SubSize;
  bg: SubBg;
  pos: SubPos;
}
const SIZES: SubSize[] = ['s', 'm', 'l', 'xl', 'xxl', 'xxxl'];
const BGS: SubBg[] = ['none', 'box', 'solid'];
const POSS: SubPos[] = ['low', 'mid', 'high'];
const SIZE_PX: Record<SubSize, number> = {s: 14, m: 18, l: 24, xl: 31, xxl: 40, xxxl: 50};
const BG_COLOR: Record<SubBg, string> = {none: 'transparent', box: 'rgba(0,0,0,0.6)', solid: '#000'};
const SIZE_KEY: Record<SubSize, Key> = {
  s: 'player.size_s',
  m: 'player.size_m',
  l: 'player.size_l',
  xl: 'player.size_xl',
  xxl: 'player.size_xxl',
  xxxl: 'player.size_xxxl',
};
const BG_KEY: Record<SubBg, Key> = {
  none: 'player.bg_none',
  box: 'player.bg_box',
  solid: 'player.bg_solid',
};
const POS_KEY: Record<SubPos, Key> = {
  low: 'player.pos_low',
  mid: 'player.pos_mid',
  high: 'player.pos_high',
};
const DEFAULT_SUB_STYLE: SubStyle = {size: 'm', bg: 'none', pos: 'low'};

interface TrackOption {
  index: number;
  label: string;
  language: string | null;
}
interface SubOption extends TrackOption {
  url: string;
}
interface Cue {
  start: number;
  end: number;
  text: string;
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

// WebVTT time -> seconds. Accepts HH:MM:SS.mmm or MM:SS.mmm (',' decimal tolerated).
function parseVttTime(s: string): number {
  const m = s.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/);
  if (!m) {
    return NaN;
  }
  const h = m[1] ? parseInt(m[1], 10) : 0;
  return h * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4].padEnd(3, '0'), 10) / 1000;
}

// Minimal WebVTT parser — the backend always serves VTT (SRT converted, ASS via &as=vtt).
// We render subtitles ourselves so the style (size / background / position) is fully under
// our control; react-native-video's native renderer only exposes fontSize + padding.
function parseVtt(data: string): Cue[] {
  const cues: Cue[] = [];
  const lines = data.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const arrow = lines[i].indexOf('-->');
    if (arrow === -1) {
      continue;
    }
    const start = parseVttTime(lines[i].slice(0, arrow));
    const end = parseVttTime(lines[i].slice(arrow + 3).trim().split(/\s+/)[0]);
    i++;
    const body: string[] = [];
    for (; i < lines.length && lines[i].trim() !== ''; i++) {
      body.push(lines[i]);
    }
    if (!isNaN(start) && !isNaN(end)) {
      const text = body
        .join('\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\{[^}]*\}/g, '')
        .trim();
      if (text) {
        cues.push({start, end, text});
      }
    }
  }
  return cues;
}

export default function PlayerScreen({navigation, route}: Props): React.JSX.Element {
  const {api, config} = useDevice();
  const {t} = useI18n();
  const {episodeId} = route.params;
  const {width: winW, height: winH} = useWindowDimensions();
  const landscape = winW > winH;
  const panelPadTop = landscape ? 14 : 40;
  const insets = useSafeAreaInsets();
  const videoRef = useRef<VideoRef>(null);
  const lastSaved = useRef(0);
  const creditsSavedFor = useRef<number | null>(null); // episode whose credits-entry save went out
  // Target of an in-flight seek (null = none). While set, onProgress holds the bar
  // at the target instead of trusting the stale pre-seek position the player reports.
  const seekTargetRef = useRef<number | null>(null);
  // Resume-on-open is one-shot: a re-fired onLoad (e.g. after a buffering stall on a
  // slow source) must not yank playback back to the saved position again.
  const didResumeRef = useRef(false);
  // Double-tap-to-seek bookkeeping: the previous tap (for pairing) and the deferred
  // single-tap timer (controls toggle) so a second tap can cancel it.
  const lastTapRef = useRef<{t: number; side: 'l' | 'r' | 'c'} | null>(null);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [cues, setCues] = useState<Cue[]>([]);
  const [cueText, setCueText] = useState('');
  const [picker, setPicker] = useState<'audio' | 'text' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [subStyle, setSubStyle] = useState<SubStyle>(DEFAULT_SUB_STYLE);
  const [skip, setSkip] = useState<'intro' | 'outro' | null>(null);
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_START);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);
  const [panelH, setPanelH] = useState(0);

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
        const p = JSON.parse(v) as Partial<SubStyle>;
        setSubStyle(s => ({
          size: p.size && SIZES.includes(p.size) ? p.size : s.size,
          bg: p.bg && BGS.includes(p.bg) ? p.bg : s.bg,
          pos: p.pos && POSS.includes(p.pos) ? p.pos : s.pos,
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
      if (singleTapTimer.current) {
        clearTimeout(singleTapTimer.current);
      }
    };
  }, []);

  // Immersive fullscreen: hide the status + 3-button navigation bars while playing
  // (sticky — a swipe reveals them briefly), and restore them on leaving the player.
  useEffect(() => {
    void SystemNavigationBar.stickyImmersive(true);
    return () => {
      void SystemNavigationBar.stickyImmersive(false);
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

  const subOptions = useMemo<SubOption[]>(
    () =>
      (info?.subtitle_tracks ?? []).map((tr, i) => ({
        index: i,
        label: tr.label,
        language: tr.language,
        url: mediaUrl(base, token, tr.format === 'ass' ? `${tr.url}&as=vtt` : tr.url) ?? '',
      })),
    [info, base, token],
  );

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
      setTextIndex(tracks.findIndex(tr => (tr.language ?? '') === pref || tr.label === pref));
    });
  }, [info]);

  // Fetch + parse the chosen subtitle so we can render it ourselves.
  useEffect(() => {
    const opt = textIndex >= 0 ? subOptions[textIndex] : undefined;
    if (!opt || !opt.url) {
      setCues([]);
      setCueText('');
      return undefined;
    }
    let cancelled = false;
    fetch(opt.url)
      .then(r => r.text())
      .then(txt => !cancelled && setCues(parseVtt(txt)))
      .catch(() => !cancelled && setCues([]));
    return () => {
      cancelled = true;
    };
  }, [textIndex, subOptions]);

  // Neighbouring episodes for prev/next + auto-advance.
  const flat: Episode[] = useMemo(
    () => (series ? series.seasons.flatMap(s => s.episodes) : []),
    [series],
  );
  const curIdx = flat.findIndex(e => e.id === episodeId);
  const prevId = curIdx > 0 ? flat[curIdx - 1].id : null;
  const nextId = curIdx >= 0 && curIdx + 1 < flat.length ? flat[curIdx + 1].id : null;

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

  // Every seek goes through here so onProgress knows a jump is in flight and won't
  // overwrite the bar with the player's stale pre-seek position (reads refs only,
  // so the once-created PanResponder can call it without a stale closure).
  const seekTo = (target: number): void => {
    seekTargetRef.current = target;
    videoRef.current?.seek(target);
  };

  // Single tap toggles the controls; a quick second tap on the left/right third seeks
  // ∓15s instead (chained taps accumulate off the in-flight seek target). The single-tap
  // action is deferred by DOUBLE_TAP_MS so a double tap can cancel it before it fires.
  const handleTap = (e: GestureResponderEvent): void => {
    const x = e.nativeEvent.locationX;
    const side: 'l' | 'r' | 'c' = x < winW * 0.35 ? 'l' : x > winW * 0.65 ? 'r' : 'c';
    const now = Date.now();
    const prev = lastTapRef.current;
    if (prev && side !== 'c' && prev.side === side && now - prev.t < DOUBLE_TAP_MS) {
      if (singleTapTimer.current) {
        clearTimeout(singleTapTimer.current);
        singleTapTimer.current = null;
      }
      lastTapRef.current = null;
      const from = seekTargetRef.current ?? current;
      const target =
        side === 'r' ? Math.min(duration || from, from + SEEK_STEP_S) : Math.max(0, from - SEEK_STEP_S);
      seekTo(target);
      setCurrent(target);
      return;
    }
    lastTapRef.current = {t: now, side};
    if (singleTapTimer.current) {
      clearTimeout(singleTapTimer.current);
    }
    singleTapTimer.current = setTimeout(() => {
      singleTapTimer.current = null;
      lastTapRef.current = null;
      toggleControls();
    }, DOUBLE_TAP_MS);
  };

  const onLoad = (data: OnLoadData): void => {
    setDuration(data.duration);
    // Resume only to a mid-episode position — a saved point in the closing seconds
    // (credits, or a stale save) would start an unwatched episode at its end.
    if (
      info &&
      info.resume_position > 5 &&
      info.resume_position < data.duration - 30 &&
      !didResumeRef.current
    ) {
      didResumeRef.current = true;
      seekTo(info.resume_position);
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
    void AsyncStorage.setItem(SUB_PREF_KEY, opt.language ?? opt.label);
  };

  const turnOffText = (): void => {
    setTextIndex(-1);
    setPicker(null);
    void AsyncStorage.setItem(SUB_PREF_KEY, 'off');
  };

  const persistStyle = (next: SubStyle): SubStyle => {
    void AsyncStorage.setItem(SUB_STYLE_KEY, JSON.stringify(next));
    return next;
  };
  const setSize = (size: SubSize): void => setSubStyle(s => persistStyle({...s, size}));
  const setBg = (bg: SubBg): void => setSubStyle(s => persistStyle({...s, bg}));
  const setPos = (pos: SubPos): void => setSubStyle(s => persistStyle({...s, pos}));

  // The seek has landed once the player itself reports being near the target.
  const onSeek = (data: OnSeekData): void => {
    if (Math.abs(data.currentTime - data.seekTime) < SEEK_SETTLE_S) {
      seekTargetRef.current = null;
    }
  };

  const onProgress = (data: OnProgressData): void => {
    const pos = data.currentTime;
    // Hold the bar at the seek target until playback actually reaches it; otherwise a
    // slow source's stale pre-seek position would snap the bar back (the "bouncing").
    const target = seekTargetRef.current;
    if (target !== null) {
      if (Math.abs(pos - target) < SEEK_SETTLE_S) {
        seekTargetRef.current = null;
      } else {
        return;
      }
    }
    if (!scrubbing) {
      setCurrent(pos);
    }
    let active = '';
    for (let k = 0; k < cues.length; k++) {
      if (pos >= cues[k].start && pos <= cues[k].end) {
        active = cues[k].text;
        break;
      }
    }
    setCueText(prev => (prev === active ? prev : active));
    if (info) {
      if (info.intro_start != null && info.intro_end != null && pos >= info.intro_start && pos < info.intro_end) {
        setSkip('intro');
      } else if (info.outro_start != null && pos >= info.outro_start) {
        setSkip('outro');
        if (api && creditsSavedFor.current !== episodeId) {
          // Reaching the credits marks the episode watched — save the moment it
          // happens, not on the 10s cadence, so leaving right away still counts.
          creditsSavedFor.current = episodeId;
          lastSaved.current = pos;
          void api.recordWatch(episodeId, {
            position_seconds: pos,
            duration_seconds: duration > 0 ? duration : undefined,
          });
        }
      } else if (nextId != null && duration > 0 && pos >= duration - NEXT_EPISODE_WINDOW_S) {
        // No authored outro chapter, but a next episode exists — prompt for it over the
        // closing window so the "next episode" button is reachable on these rips too.
        setSkip('outro');
      } else {
        setSkip(null);
      }
    }
    if (api && pos - lastSaved.current >= SAVE_INTERVAL_S) {
      lastSaved.current = pos;
      void api.recordWatch(episodeId, {
        position_seconds: pos,
        duration_seconds: duration > 0 ? duration : undefined,
      });
    }
  };

  // With the credits running to (nearly) the file's end, skipping the outro and "next
  // episode" are the same act; a larger gap means post-credits content, so the chip must
  // only seek past the credits and keep playing.
  const outroLeadsToNext =
    info?.outro_end == null || duration <= 0 || duration - info.outro_end <= 10;

  const doSkip = (): void => {
    // Land a beat AFTER the marker: the fingerprint-matched end is soft by up to a
    // second where the theme crossfades into the episode, and landing inside that
    // tail would still show a flash of the intro/outro.
    if (skip === 'intro' && info?.intro_end != null) {
      seekTo(info.intro_end + SKIP_LANDING_MARGIN_S);
      setSkip(null);
    } else if (skip === 'outro') {
      if (outroLeadsToNext) {
        goNext();
      } else if (info?.outro_end != null) {
        seekTo(info.outro_end + SKIP_LANDING_MARGIN_S);
        setSkip(null);
      }
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
        seekTo(target);
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
        {info?.prepare_eta_seconds != null && (
          <Text style={styles.prepEta}>
            {t('player.etaApprox', {minutes: Math.max(1, Math.round(info.prepare_eta_seconds / 60))})}
          </Text>
        )}
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
  const baseBottom = subStyle.pos === 'high' ? winH * 0.6 : subStyle.pos === 'mid' ? winH * 0.34 : winH * 0.05;
  // Lift subtitles above the controls panel while it's open (measured height).
  const subBottom = controlsVisible && panelH > 0 ? panelH + 16 : baseBottom;

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <Video
        ref={videoRef}
        source={{uri: streamUrl}}
        style={styles.video}
        paused={paused}
        resizeMode="contain"
        progressUpdateInterval={250}
        bufferConfig={BUFFER_CONFIG}
        bufferingStrategy={BufferingStrategyType.DEPENDING_ON_MEMORY}
        selectedAudioTrack={
          audioIndex >= 0 ? {type: SelectedTrackType.INDEX, value: audioIndex} : undefined
        }
        onLoad={onLoad}
        onProgress={onProgress}
        onSeek={onSeek}
        onEnd={onEnd}
        onError={() => setError(t('player.error'))}
      />

      {/* Custom subtitle overlay (rendered by us for full style control). */}
      {textIndex >= 0 && cueText !== '' && !ended && (
        <View pointerEvents="none" style={[styles.subWrap, {bottom: subBottom}]}>
          <Text
            style={[styles.subText, {fontSize: SIZE_PX[subStyle.size], backgroundColor: BG_COLOR[subStyle.bg]}]}>
            {cueText}
          </Text>
        </View>
      )}

      {/* Tap layer: single tap toggles the controls; double tap on an edge seeks ∓15s. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={handleTap} />

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
            {skip === 'intro'
              ? t('player.skipIntro')
              : outroLeadsToNext
                ? t('player.nextEpisode')
                : t('player.skipOutro')}
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
            style={[
              styles.panel,
              {
                // Clear the system bars / display cutout in landscape so the episode strip
                // isn't hidden under them.
                paddingBottom: 20 + insets.bottom,
                paddingLeft: 24 + insets.left,
                paddingRight: 24 + insets.right,
                // Tighter top in landscape, and capped so the panel never reaches (overlaps)
                // the back button at the top — overflow is clipped from the top, not the strip.
                paddingTop: panelPadTop,
                maxHeight: winH - 56,
              },
            ]}
            onLayout={e => setPanelH(e.nativeEvent.layout.height)}
            pointerEvents="box-none">
            {!landscape && (
              <>
                <Text style={styles.title} numberOfLines={1}>
                  {info.series_title}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {t('series.episode', {number: info.episode_number})}
                  {info.episode_title ? ` — ${info.episode_title}` : ''}
                </Text>
              </>
            )}

            {/* Scrubber */}
            <View style={styles.scrubRow}>
              <Text style={styles.time}>{fmt(displayPos)}</Text>
              <View
                style={styles.barHit}
                onLayout={e => (barWRef.current = e.nativeEvent.layout.width)}
                {...pan.panHandlers}>
                <View style={styles.barTrack}>
                  <LinearGradient
                    colors={theme.gradient}
                    start={{x: 0, y: 0}}
                    end={{x: 1, y: 0}}
                    style={[styles.barFill, {width: `${pct}%`}]}
                  />
                  <View style={[styles.barThumb, {left: `${pct}%`}]} />
                </View>
              </View>
              <Text style={styles.time}>{fmt(duration)}</Text>
            </View>

            {/* Transport */}
            <View style={styles.transport}>
              {subOptions.length > 0 && (
                <CtrlButton icon="subtitles" on={textIndex >= 0} onPress={act(() => setPicker('text'))} />
              )}
              {audioTracks.length > 0 && (
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
              <LinearGradient
                colors={theme.gradient}
                start={{x: 0, y: 0}}
                end={{x: 1, y: 1}}
                style={StyleSheet.absoluteFill}
              />
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
        options={subOptions}
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
        onBg={setBg}
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
      style={[styles.epCard, current && styles.epCardCurrent, focused && styles.epCardFocused]}>
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

function Choice({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable onPress={onPress} style={styles.choice}>
      {active && (
        <LinearGradient
          colors={theme.gradient}
          start={{x: 0, y: 0}}
          end={{x: 1, y: 0}}
          style={StyleSheet.absoluteFill}
        />
      )}
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </Pressable>
  );
}

function SubtitleSettings({
  visible,
  style,
  onSize,
  onBg,
  onPos,
  onClose,
  t,
}: {
  visible: boolean;
  style: SubStyle;
  onSize: (s: SubSize) => void;
  onBg: (b: SubBg) => void;
  onPos: (p: SubPos) => void;
  onClose: () => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* ScrollView so the rows never get clipped on short (landscape) screens. */}
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={[styles.sheetContent, {paddingBottom: insets.bottom + 20}]}
          showsVerticalScrollIndicator={false}
          onStartShouldSetResponder={() => true}>
          <Text style={styles.sheetTitle}>{t('player.subtitleSettings')}</Text>

          <Text style={styles.settingLabel}>{t('player.size')}</Text>
          <View style={styles.pillRow}>
            {SIZES.map(s => (
              <Choice
                key={s}
                active={style.size === s}
                label={t(SIZE_KEY[s])}
                onPress={() => onSize(s)}
              />
            ))}
          </View>

          <Text style={styles.settingLabel}>{t('player.background')}</Text>
          <View style={styles.pillRow}>
            {BGS.map(b => (
              <Choice
                key={b}
                active={style.bg === b}
                label={t(BG_KEY[b])}
                onPress={() => onBg(b)}
              />
            ))}
          </View>

          <Text style={styles.settingLabel}>{t('player.position')}</Text>
          <View style={styles.pillRow}>
            {POSS.map(p => (
              <Choice
                key={p}
                active={style.pos === p}
                label={t(POS_KEY[p])}
                onPress={() => onPos(p)}
              />
            ))}
          </View>
        </ScrollView>
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
  prepEta: {color: theme.muted, fontSize: 14},
  pill: {paddingVertical: 10, paddingHorizontal: 20, backgroundColor: theme.surfaceStrong, borderRadius: 999},
  pillText: {color: theme.text, fontSize: 15},

  subWrap: {position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 24},
  subText: {color: '#fff', fontWeight: '600', textAlign: 'center', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, overflow: 'hidden', textShadowColor: '#000', textShadowOffset: {width: 0, height: 1}, textShadowRadius: 5},

  overlay: {...StyleSheet.absoluteFillObject},
  topBar: {flexDirection: 'row', padding: 14},
  backBtn: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.35)'},
  backLabel: {color: '#fff', fontSize: 15, fontWeight: '600'},

  // Anchored to the bottom (not a space-between flex child): in landscape the panel content can
  // be taller than the screen, and an overflowing space-between child pushed the episode strip
  // off the bottom. Absolute bottom keeps the strip pinned to the bottom; overflow spills up.
  panel: {position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 24, paddingTop: 40, paddingBottom: 20, overflow: 'hidden', justifyContent: 'flex-end'},
  title: {color: '#fff', fontSize: 20, fontWeight: '800'},
  meta: {color: theme.muted, fontSize: 14, marginTop: 2, marginBottom: 12},

  scrubRow: {flexDirection: 'row', alignItems: 'center', marginBottom: 10},
  time: {color: '#fff', fontSize: 13, width: 56, textAlign: 'center', fontVariant: ['tabular-nums']},
  barHit: {flex: 1, paddingVertical: 12, justifyContent: 'center'},
  barTrack: {height: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.25)'},
  barFill: {position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 999},
  barThumb: {position: 'absolute', top: '50%', width: 16, height: 16, borderRadius: 8, marginLeft: -8, marginTop: -8, backgroundColor: '#fff', shadowColor: theme.accent, shadowOpacity: 0.9, shadowRadius: 6, elevation: 4},

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

  skip: {position: 'absolute', right: 24, bottom: 24, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 999, overflow: 'hidden'},
  skipText: {color: '#fff', fontWeight: '700', fontSize: 15},

  endedOverlay: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,6,11,0.85)', alignItems: 'center', justifyContent: 'center', gap: 14},
  endedTitle: {color: '#fff', fontSize: 24, fontWeight: '800'},
  endedSub: {color: theme.muted, fontSize: 16},
  endedRow: {flexDirection: 'row', gap: 12, marginTop: 8},
  endedBtn: {borderRadius: 999, paddingVertical: 12, paddingHorizontal: 26, overflow: 'hidden'},
  endedBtnText: {color: '#fff', fontWeight: '700', fontSize: 16},

  backdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end'},
  sheet: {backgroundColor: '#0C0E19', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, maxHeight: '70%'},
  sheetScroll: {backgroundColor: '#0C0E19', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85%', flexGrow: 0},
  sheetContent: {paddingHorizontal: 20, paddingTop: 20},
  sheetTitle: {color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 12},
  option: {paddingVertical: 14},
  optionText: {color: theme.muted, fontSize: 16},
  optionActive: {color: theme.accent, fontWeight: '700'},
  settingLabel: {color: theme.muted, fontSize: 14, marginTop: 12, marginBottom: 8},
  pillRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  choice: {paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden'},
  choiceText: {color: theme.muted, fontSize: 14, fontWeight: '600'},
  choiceTextActive: {color: '#fff'},
});
