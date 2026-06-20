import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {mediaUrl, type HomeData, type HomeSeries, type Library} from '../api/client';
import {Brand} from '../components/Brand';
import {Icon} from '../components/Icon';
import {GradientButton} from '../components/GradientButton';
import {useDevice} from '../context/DeviceContext';
import {useI18n} from '../i18n';
import type {RootStackParamList} from '../navigation';
import {theme} from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export default function HomeScreen({navigation}: Props): React.JSX.Element {
  const {api, config} = useDevice();
  const {t} = useI18n();
  const insets = useSafeAreaInsets();
  const [home, setHome] = useState<HomeData | null>(null);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [error, setError] = useState<string | null>(null);

  const base = config?.serverUrl ?? '';
  const token = config?.deviceToken ?? null;

  useEffect(() => {
    if (!api) {
      return;
    }
    api.getHome().then(setHome).catch((e: unknown) => setError(String(e)));
    api.getLibraries().then(setLibraries).catch(() => undefined);
  }, [api]);

  const poster = useCallback(
    (s: HomeSeries) => mediaUrl(base, token, s.cover_image_url),
    [base, token],
  );

  const openSeries = (s: HomeSeries): void =>
    s.continue_episode_id
      ? navigation.navigate('Player', {episodeId: s.continue_episode_id})
      : navigation.navigate('Series', {seriesId: s.id});

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{t('common.loadError', {error})}</Text>
      </View>
    );
  }
  if (!home) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  const hero = home.hero;

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.scrollContent, {paddingTop: insets.top + 12}]}>
      <View style={styles.header}>
        <Brand size={30} />
        <Pressable onPress={() => navigation.navigate('Settings')} hitSlop={12}>
          <Text style={styles.settings}>{t('home.settings')}</Text>
        </Pressable>
      </View>

      {hero && (
        <Pressable style={styles.hero} onPress={() => openSeries(hero)}>
          {mediaUrl(base, token, hero.banner_image_url ?? hero.cover_image_url) ? (
            <Image
              source={{uri: mediaUrl(base, token, hero.banner_image_url ?? hero.cover_image_url)}}
              style={styles.heroImg}
            />
          ) : (
            <View style={[styles.heroImg, styles.heroEmpty]} />
          )}
          <LinearGradient
            colors={['transparent', 'rgba(5,6,11,0.55)', 'rgba(5,6,11,0.96)']}
            style={styles.heroScrim}
          />
          <View style={styles.heroContent}>
            <Text style={styles.heroTitle} numberOfLines={2}>
              {hero.display_title ?? hero.title}
            </Text>
            <GradientButton
              label={hero.continue_episode_id ? t('series.continue') : t('series.play')}
              onPress={() => openSeries(hero)}
              style={styles.heroCta}
            />
          </View>
        </Pressable>
      )}

      {home.continue_watching.length > 0 && (
        <Section title={t('home.continue')}>
          <FlatList
            horizontal
            data={home.continue_watching}
            keyExtractor={s => String(s.id)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
            renderItem={({item}) => (
              <PosterCard
                title={item.display_title ?? item.title}
                uri={poster(item)}
                progress={item.continue_percent}
                completed={item.watch_status === 'completed'}
                onPress={() => openSeries(item)}
              />
            )}
          />
        </Section>
      )}

      {home.recently_added.length > 0 && (
        <Section title={t('home.recentlyAdded')}>
          <FlatList
            horizontal
            data={home.recently_added}
            keyExtractor={s => String(s.id)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
            renderItem={({item}) => (
              <PosterCard
                title={item.display_title ?? item.title}
                uri={poster(item)}
                completed={item.watch_status === 'completed'}
                onPress={() => navigation.navigate('Series', {seriesId: item.id})}
              />
            )}
          />
        </Section>
      )}

      <Section title={t('home.libraries')}>
        <View style={styles.libs}>
          {libraries.map(lib => (
            <Pressable
              key={lib.id}
              onPress={() => navigation.navigate('Library', {libraryId: lib.id, name: lib.name})}>
              <LinearGradient
                colors={theme.gradient}
                start={{x: 0, y: 0}}
                end={{x: 1, y: 1}}
                style={styles.libBorder}>
                <View style={styles.lib}>
                  <Icon name={lib.kind} size={28} color={theme.accent2} />
                  <View style={styles.libText}>
                    <Text style={styles.libName}>{lib.name}</Text>
                    <Text style={styles.libCount}>{t('home.titleCount', {count: lib.series_count})}</Text>
                  </View>
                </View>
              </LinearGradient>
            </Pressable>
          ))}
        </View>
      </Section>
    </ScrollView>
  );
}

function Section({title, children}: {title: string; children: React.ReactNode}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function PosterCard({
  title,
  uri,
  onPress,
  progress,
  normalized,
  completed,
  width = POSTER_W,
}: {
  title: string;
  uri: string | undefined;
  onPress: () => void;
  progress?: number;
  normalized?: boolean;
  completed?: boolean;
  width?: number;
}): React.JSX.Element {
  return (
    <Pressable style={{width}} onPress={onPress}>
      <View>
        {uri ? (
          <Image source={{uri}} style={[styles.poster, {width, height: width * 1.5}]} />
        ) : (
          <View style={[styles.poster, styles.posterEmpty, {width, height: width * 1.5}]} />
        )}
        {completed ? (
          <View style={styles.watchedBadge}>
            <Text style={styles.watchedText}>✓</Text>
          </View>
        ) : null}
        {normalized ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>✓</Text>
          </View>
        ) : null}
        {progress != null && progress > 0 ? (
          <View style={styles.progressTrack}>
            <LinearGradient
              colors={theme.gradient}
              start={{x: 0, y: 0}}
              end={{x: 1, y: 0}}
              style={[styles.progressFill, {width: `${Math.min(100, progress)}%`}]}
            />
          </View>
        ) : null}
      </View>
      <Text style={styles.cardTitle} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

const POSTER_W = 130;

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: theme.bg},
  scrollContent: {paddingBottom: 40},
  center: {flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center'},
  error: {color: '#f87171', padding: 24},
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 8},
  settings: {color: theme.muted, fontSize: 15},

  hero: {marginHorizontal: 20, marginTop: 8, borderRadius: theme.radius, overflow: 'hidden', height: 200},
  heroImg: {...StyleSheet.absoluteFillObject, width: '100%', height: '100%', backgroundColor: theme.surface},
  heroEmpty: {borderWidth: 1, borderColor: theme.border},
  heroScrim: {...StyleSheet.absoluteFillObject},
  heroContent: {position: 'absolute', left: 18, right: 18, bottom: 16},
  heroTitle: {color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 12},
  heroCta: {alignSelf: 'flex-start'},

  section: {marginTop: 18},
  sectionTitle: {color: theme.text, fontSize: 18, fontWeight: '700', paddingHorizontal: 20, marginBottom: 10},
  row: {paddingHorizontal: 20, gap: 12},

  poster: {width: POSTER_W, height: POSTER_W * 1.5, borderRadius: theme.radius, backgroundColor: theme.surface},
  posterEmpty: {borderWidth: 1, borderColor: theme.border},
  badge: {position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(5,6,11,0.7)', alignItems: 'center', justifyContent: 'center'},
  badgeText: {color: '#34d399', fontSize: 13, fontWeight: '800'},
  watchedBadge: {position: 'absolute', top: 6, left: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center'},
  watchedText: {color: '#fff', fontSize: 13, fontWeight: '800'},
  progressTrack: {position: 'absolute', left: 6, right: 6, bottom: 6, height: 4, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.5)', overflow: 'hidden'},
  progressFill: {height: '100%', borderRadius: 999},
  cardTitle: {color: theme.text, fontSize: 13, marginTop: 6},

  libs: {flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, gap: 12},
  libBorder: {borderRadius: theme.radius, padding: 1.5},
  lib: {flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#0C0E19', borderRadius: theme.radius - 1, paddingVertical: 14, paddingHorizontal: 16, minWidth: 160},
  libText: {flexShrink: 1},
  libName: {color: theme.text, fontSize: 16, fontWeight: '600'},
  libCount: {color: theme.muted, fontSize: 13, marginTop: 4},
});
