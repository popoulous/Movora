import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import React, {useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {mediaUrl, type Episode, type SeriesDetail} from '../api/client';
import {useDevice} from '../context/DeviceContext';
import {useI18n} from '../i18n';
import type {RootStackParamList} from '../navigation';
import {theme} from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Series'>;

export default function SeriesScreen({navigation, route}: Props): React.JSX.Element {
  const {api, config} = useDevice();
  const {t} = useI18n();
  const insets = useSafeAreaInsets();
  const {seriesId} = route.params;
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base = config?.serverUrl ?? '';
  const token = config?.deviceToken ?? null;

  useEffect(() => {
    if (!api) {
      return;
    }
    api.getSeries(seriesId).then(setSeries).catch((e: unknown) => setError(String(e)));
  }, [api, seriesId]);

  const episodes = useMemo<Episode[]>(
    () => (series ? series.seasons.flatMap(s => s.episodes) : []),
    [series],
  );

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{t('common.loadError', {error})}</Text>
      </View>
    );
  }
  if (!series) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  const continueId = series.watch?.continue_episode_id ?? null;
  const firstId = episodes[0]?.id ?? null;

  const header = (
    <View>
      {mediaUrl(base, token, series.banner_image_url) ? (
        <Image source={{uri: mediaUrl(base, token, series.banner_image_url)}} style={styles.banner} />
      ) : (
        <View style={[styles.banner, styles.bannerEmpty]} />
      )}
      <View style={styles.meta}>
        <Text style={styles.title}>{series.display_title ?? series.title}</Text>
        <Text style={styles.sub}>
          {[series.year, series.genres].filter(Boolean).join(' · ')}
        </Text>
        {series.description ? (
          <Text style={styles.desc} numberOfLines={4}>
            {series.description}
          </Text>
        ) : null}
        <View style={styles.actions}>
          {(continueId ?? firstId) != null && (
            <Pressable
              style={styles.play}
              onPress={() => navigation.navigate('Player', {episodeId: (continueId ?? firstId)!})}>
              <Text style={styles.playText}>
                {continueId ? t('series.continue') : t('series.play')}
              </Text>
            </Pressable>
          )}
        </View>
        <Text style={styles.epHeader}>{t('series.episodes')}</Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.root, {paddingTop: insets.top}]}>
      <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.backWrap}>
        <Text style={styles.back}>‹ {t('common.back')}</Text>
      </Pressable>
      <FlatList
        data={episodes}
        keyExtractor={e => String(e.id)}
        ListHeaderComponent={header}
        contentContainerStyle={styles.listContent}
        renderItem={({item}) => (
          <Pressable
            style={styles.episode}
            onPress={() => navigation.navigate('Player', {episodeId: item.id})}>
            {mediaUrl(base, token, item.thumbnail_url) ? (
              <Image source={{uri: mediaUrl(base, token, item.thumbnail_url)}} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbEmpty]} />
            )}
            <View style={styles.epText}>
              <Text style={styles.epTitle} numberOfLines={1}>
                {item.end_number != null
                  ? t('series.episodeRange', {from: item.number, to: item.end_number})
                  : t('series.episode', {number: item.number})}
                {item.watched ? '  ✓' : ''}
              </Text>
              {item.title ? (
                <Text style={styles.epSub} numberOfLines={1}>
                  {item.title}
                </Text>
              ) : null}
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: theme.bg},
  listContent: {paddingBottom: 40},
  center: {flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center'},
  error: {color: '#f87171', padding: 24},
  backWrap: {paddingHorizontal: 20, paddingVertical: 8},
  back: {color: theme.muted, fontSize: 15},
  banner: {width: '100%', height: 200, backgroundColor: theme.surface},
  bannerEmpty: {borderBottomWidth: 1, borderColor: theme.border},
  meta: {paddingHorizontal: 20, marginTop: 12},
  title: {color: '#fff', fontSize: 26, fontWeight: '800'},
  sub: {color: theme.muted, fontSize: 14, marginTop: 4},
  desc: {color: theme.text, fontSize: 14, marginTop: 12, lineHeight: 20},
  actions: {flexDirection: 'row', gap: 12, marginTop: 16},
  play: {backgroundColor: theme.accent, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 28},
  playText: {color: '#fff', fontWeight: '700', fontSize: 16},
  epHeader: {color: theme.text, fontSize: 18, fontWeight: '700', marginTop: 22, marginBottom: 6},
  episode: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 8, gap: 12},
  thumb: {width: 120, height: 68, borderRadius: 8, backgroundColor: theme.surface},
  thumbEmpty: {borderWidth: 1, borderColor: theme.border},
  epText: {flex: 1},
  epTitle: {color: theme.text, fontSize: 15, fontWeight: '600'},
  epSub: {color: theme.muted, fontSize: 13, marginTop: 2},
});
