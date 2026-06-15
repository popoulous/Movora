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
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {mediaUrl, type HomeData, type HomeSeries, type Library} from '../api/client';
import {useDevice} from '../context/DeviceContext';
import type {RootStackParamList} from '../navigation';
import {theme} from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export default function HomeScreen({navigation}: Props): React.JSX.Element {
  const {api, config} = useDevice();
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

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Betöltési hiba: {error}</Text>
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

  return (
    <ScrollView style={styles.root} contentContainerStyle={{paddingTop: insets.top + 12, paddingBottom: 40}}>
      <View style={styles.header}>
        <Text style={styles.brand}>MOVORA</Text>
        <Pressable onPress={() => navigation.navigate('Settings')} hitSlop={12}>
          <Text style={styles.settings}>Beállítások</Text>
        </Pressable>
      </View>

      {home.continue_watching.length > 0 && (
        <Section title="Folytatás">
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
                onPress={() =>
                  item.continue_episode_id
                    ? navigation.navigate('Player', {episodeId: item.continue_episode_id})
                    : navigation.navigate('Series', {seriesId: item.id})
                }
              />
            )}
          />
        </Section>
      )}

      {home.recently_added.length > 0 && (
        <Section title="Nemrég hozzáadva">
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
                onPress={() => navigation.navigate('Series', {seriesId: item.id})}
              />
            )}
          />
        </Section>
      )}

      <Section title="Könyvtárak">
        <View style={styles.libs}>
          {libraries.map(lib => (
            <Pressable
              key={lib.id}
              style={styles.lib}
              onPress={() => navigation.navigate('Library', {libraryId: lib.id, name: lib.name})}>
              <Text style={styles.libName}>{lib.name}</Text>
              <Text style={styles.libCount}>{lib.series_count} cím</Text>
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
}: {
  title: string;
  uri: string | undefined;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      {uri ? (
        <Image source={{uri}} style={styles.poster} />
      ) : (
        <View style={[styles.poster, styles.posterEmpty]} />
      )}
      <Text style={styles.cardTitle} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

const POSTER_W = 130;

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: theme.bg},
  center: {flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center'},
  error: {color: '#f87171', padding: 24},
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 8},
  brand: {fontSize: 22, fontWeight: '800', letterSpacing: 3, color: '#fff'},
  settings: {color: theme.muted, fontSize: 15},
  section: {marginTop: 18},
  sectionTitle: {color: theme.text, fontSize: 18, fontWeight: '700', paddingHorizontal: 20, marginBottom: 10},
  row: {paddingHorizontal: 20, gap: 12},
  card: {width: POSTER_W, marginRight: 12},
  poster: {width: POSTER_W, height: POSTER_W * 1.5, borderRadius: theme.radius, backgroundColor: theme.surface},
  posterEmpty: {borderWidth: 1, borderColor: theme.border},
  cardTitle: {color: theme.text, fontSize: 13, marginTop: 6},
  libs: {flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, gap: 12},
  lib: {backgroundColor: theme.surface, borderRadius: theme.radius, paddingVertical: 16, paddingHorizontal: 18, borderWidth: 1, borderColor: theme.border, minWidth: 150},
  libName: {color: theme.text, fontSize: 16, fontWeight: '600'},
  libCount: {color: theme.muted, fontSize: 13, marginTop: 4},
});
