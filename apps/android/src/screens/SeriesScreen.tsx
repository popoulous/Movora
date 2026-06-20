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
import LinearGradient from 'react-native-linear-gradient';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {mediaUrl, type SeriesDetail} from '../api/client';
import {GradientButton} from '../components/GradientButton';
import {PosterCard} from './HomeScreen';
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

  const [seasonIdx, setSeasonIdx] = useState(0);
  const seasons = useMemo(
    () =>
      series
        ? [...series.seasons]
            .sort((a, b) => a.number - b.number)
            .map(s => ({...s, episodes: [...s.episodes].sort((a, b) => a.number - b.number)}))
        : [],
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
  const firstId = seasons[0]?.episodes[0]?.id ?? null;
  const playId = continueId ?? firstId;
  const shownEpisodes = seasons[Math.min(seasonIdx, seasons.length - 1)]?.episodes ?? [];
  const genres = (series.genres ?? '').split(',').map(g => g.trim()).filter(Boolean).slice(0, 5);
  const metaBits = [series.year ? String(series.year) : null, series.format].filter(Boolean) as string[];

  const header = (
    <View>
      <View style={styles.heroWrap}>
        {mediaUrl(base, token, series.banner_image_url ?? series.cover_image_url) ? (
          <Image
            source={{uri: mediaUrl(base, token, series.banner_image_url ?? series.cover_image_url)}}
            style={styles.banner}
          />
        ) : (
          <View style={[styles.banner, styles.bannerEmpty]} />
        )}
        <LinearGradient
          colors={['transparent', 'rgba(5,6,11,0.6)', theme.bg]}
          style={styles.bannerScrim}
        />
        <Text style={styles.title} numberOfLines={2}>
          {series.display_title ?? series.title}
        </Text>
      </View>

      <View style={styles.meta}>
        <View style={styles.metaRow}>
          {series.score != null && <Text style={styles.score}>★ {(series.score / 10).toFixed(1)}</Text>}
          {metaBits.length > 0 && <Text style={styles.sub}>{metaBits.join(' · ')}</Text>}
        </View>

        {genres.length > 0 && (
          <View style={styles.genres}>
            {genres.map(g => (
              <LinearGradient
                key={g}
                colors={theme.gradient}
                start={{x: 0, y: 0}}
                end={{x: 1, y: 1}}
                style={styles.genreBorder}>
                <View style={styles.genre}>
                  <Text style={styles.genreText}>{g}</Text>
                </View>
              </LinearGradient>
            ))}
          </View>
        )}

        {series.description ? (
          <Text style={styles.desc} numberOfLines={4}>
            {series.description}
          </Text>
        ) : null}

        {playId != null && (
          <View style={styles.actions}>
            <GradientButton
              label={continueId ? t('series.continue') : t('series.play')}
              onPress={() => navigation.navigate('Player', {episodeId: playId})}
            />
          </View>
        )}

        <Text style={styles.epHeader}>{t('series.episodes')}</Text>

        {seasons.length > 1 && (
          <View style={styles.seasonRow}>
            {seasons.map((s, i) => {
              const seasonDone = s.episodes.length > 0 && s.episodes.every(e => e.watched);
              return (
                <Pressable
                  key={s.id}
                  onPress={() => setSeasonIdx(i)}
                  style={[styles.seasonPill, i === seasonIdx && styles.seasonPillActive]}>
                  <Text style={[styles.seasonText, i === seasonIdx && styles.seasonTextActive]}>
                    {s.number === 0 ? t('series.specials') : `S${s.number}`}
                    {seasonDone ? ' ✓' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );

  const footer =
    series.recommendations.length > 0 ? (
      <View style={styles.recs}>
        <Text style={styles.epHeader}>{t('series.recommendations')}</Text>
        <FlatList
          horizontal
          data={series.recommendations}
          keyExtractor={(r, i) => `${r.target_series_id ?? 'x'}-${i}`}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.recRow}
          renderItem={({item}) => (
            <PosterCard
              title={item.title}
              uri={mediaUrl(base, token, item.cover_image_url)}
              onPress={() =>
                item.target_series_id != null &&
                navigation.push('Series', {seriesId: item.target_series_id})
              }
            />
          )}
        />
      </View>
    ) : null;

  return (
    <View style={[styles.root, {paddingTop: insets.top}]}>
      <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.backWrap}>
        <Text style={styles.back}>‹ {t('common.back')}</Text>
      </Pressable>
      <FlatList
        data={shownEpisodes}
        keyExtractor={e => String(e.id)}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
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
  backWrap: {paddingHorizontal: 20, paddingVertical: 8, zIndex: 2},
  back: {color: '#fff', fontSize: 15},

  heroWrap: {height: 230, justifyContent: 'flex-end'},
  banner: {...StyleSheet.absoluteFillObject, width: '100%', height: '100%', backgroundColor: theme.surface},
  bannerEmpty: {borderBottomWidth: 1, borderColor: theme.border},
  bannerScrim: {...StyleSheet.absoluteFillObject},
  title: {color: '#fff', fontSize: 26, fontWeight: '800', paddingHorizontal: 20, paddingBottom: 6},

  meta: {paddingHorizontal: 20, marginTop: 8},
  metaRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
  score: {color: '#fbbf24', fontSize: 15, fontWeight: '700'},
  sub: {color: theme.muted, fontSize: 14},
  genres: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12},
  genreBorder: {borderRadius: 999, padding: 1.2},
  genre: {backgroundColor: '#0C0E19', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12},
  genreText: {color: theme.text, fontSize: 12, fontWeight: '600'},
  desc: {color: theme.text, fontSize: 14, marginTop: 12, lineHeight: 20},
  actions: {flexDirection: 'row', gap: 12, marginTop: 16},
  epHeader: {color: theme.text, fontSize: 18, fontWeight: '700', marginTop: 22, marginBottom: 6},
  seasonRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8},
  seasonPill: {paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, backgroundColor: theme.surfaceStrong, borderWidth: 1, borderColor: theme.border},
  seasonPillActive: {backgroundColor: theme.accent, borderColor: theme.accent},
  seasonText: {color: theme.muted, fontSize: 13, fontWeight: '700'},
  seasonTextActive: {color: '#fff'},

  episode: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 8, gap: 12},
  thumb: {width: 120, height: 68, borderRadius: 8, backgroundColor: theme.surface},
  thumbEmpty: {borderWidth: 1, borderColor: theme.border},
  epText: {flex: 1},
  epTitle: {color: theme.text, fontSize: 15, fontWeight: '600'},
  epSub: {color: theme.muted, fontSize: 13, marginTop: 2},

  recs: {marginTop: 8},
  recRow: {paddingHorizontal: 20, gap: 12},
});
