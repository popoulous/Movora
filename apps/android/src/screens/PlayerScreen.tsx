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

import {mediaUrl, type PlaybackInfo} from '../api/client';
import {useDevice} from '../context/DeviceContext';
import type {RootStackParamList} from '../navigation';
import {theme} from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Player'>;

const SAVE_INTERVAL_S = 10;
const PREPARE_POLL_MS = 4000;
const AUDIO_PREF_PREFIX = 'movora_audio_pref_'; // + seriesId -> language

interface TrackOption {
  index: number;
  label: string;
  language: string | null;
}

export default function PlayerScreen({navigation, route}: Props): React.JSX.Element {
  const {api, config} = useDevice();
  const {episodeId} = route.params;
  const videoRef = useRef<VideoRef>(null);
  const lastSaved = useRef(0);

  const [info, setInfo] = useState<PlaybackInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [audioTracks, setAudioTracks] = useState<TrackOption[]>([]);
  const [audioIndex, setAudioIndex] = useState<number>(-1);
  const [textIndex, setTextIndex] = useState<number>(-1); // -1 = off
  const [picker, setPicker] = useState<'audio' | 'text' | null>(null);

  const base = config?.serverUrl ?? '';
  const token = config?.deviceToken ?? null;

  // Load playback info; if a device variant is still building, poll until it's ready.
  useEffect(() => {
    if (!api) {
      return undefined;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
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
          setError(i.variant_status === 'unavailable' ? 'Ez a rész nem játszható le ezen az eszközön.' : null);
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

  // Backend subtitles are served separately; pass them to the player as external tracks.
  const textTracks = useMemo(
    () =>
      (info?.subtitle_tracks ?? []).map(t => ({
        title: t.label,
        language: t.language ?? undefined,
        type: TextTrackType.VTT,
        uri: mediaUrl(base, token, t.format === 'ass' ? `${t.url}&as=vtt` : t.url) ?? '',
      })),
    [info, base, token],
  );

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

  const onProgress = (data: OnProgressData): void => {
    if (!api) {
      return;
    }
    if (data.currentTime - lastSaved.current >= SAVE_INTERVAL_S) {
      lastSaved.current = data.currentTime;
      void api.recordWatch(episodeId, {position_seconds: data.currentTime});
    }
  };

  const onEnd = (): void => {
    if (api) {
      void api.recordWatch(episodeId, {watched: true});
    }
    navigation.goBack();
  };

  const streamUrl = info ? mediaUrl(base, token, info.stream_url) : undefined;

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>‹ Vissza</Text>
        </Pressable>
      </View>
    );
  }

  if (preparing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.accent} />
        <Text style={styles.prep}>Optimalizálás folyamatban… {info?.prepare_progress ?? 0}%</Text>
        <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>‹ Vissza</Text>
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
        onLoad={onLoad}
        onProgress={onProgress}
        onEnd={onEnd}
        onError={() => setError('Lejátszási hiba.')}
      />

      <View style={styles.topBar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.topItem}>‹ Vissza</Text>
        </Pressable>
        <View style={styles.topRight}>
          {audioTracks.length > 1 && (
            <Pressable onPress={() => setPicker('audio')} hitSlop={12}>
              <Text style={styles.topItem}>Hang</Text>
            </Pressable>
          )}
          {textTracks.length > 0 && (
            <Pressable onPress={() => setPicker('text')} hitSlop={12}>
              <Text style={styles.topItem}>Felirat</Text>
            </Pressable>
          )}
        </View>
      </View>

      <TrackPicker
        visible={picker === 'audio'}
        title="Hangsáv"
        options={audioTracks}
        selected={audioIndex}
        onPick={chooseAudio}
        onClose={() => setPicker(null)}
      />
      <TrackPicker
        visible={picker === 'text'}
        title="Felirat"
        options={textTracks.map((t, i) => ({index: i, label: t.title, language: t.language ?? null}))}
        selected={textIndex}
        offLabel="Kikapcsolva"
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
  topRight: {flexDirection: 'row', gap: 20},
  topItem: {color: '#fff', fontSize: 16, fontWeight: '600', textShadowColor: '#000', textShadowRadius: 4},
  backdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end'},
  sheet: {backgroundColor: '#0C0E19', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, maxHeight: '60%'},
  sheetTitle: {color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 12},
  option: {paddingVertical: 14},
  optionText: {color: theme.muted, fontSize: 16},
  optionActive: {color: theme.accent, fontWeight: '700'},
});
