import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import React, {useEffect, useState} from 'react';
import {ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {mediaUrl, type SeriesSummary} from '../api/client';
import {useDevice} from '../context/DeviceContext';
import type {RootStackParamList} from '../navigation';
import {theme} from '../theme';
import {PosterCard} from './HomeScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'Library'>;

const COLS = 3;

export default function LibraryScreen({navigation, route}: Props): React.JSX.Element {
  const {api, config} = useDevice();
  const insets = useSafeAreaInsets();
  const {libraryId, name} = route.params;
  const [series, setSeries] = useState<SeriesSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base = config?.serverUrl ?? '';
  const token = config?.deviceToken ?? null;

  useEffect(() => {
    if (!api) {
      return;
    }
    api.listSeries(libraryId).then(setSeries).catch((e: unknown) => setError(String(e)));
  }, [api, libraryId]);

  return (
    <View style={[styles.root, {paddingTop: insets.top}]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹ Vissza</Text>
        </Pressable>
        <Text style={styles.title}>{name ?? 'Könyvtár'}</Text>
      </View>

      {error ? (
        <Text style={styles.error}>Betöltési hiba: {error}</Text>
      ) : !series ? (
        <ActivityIndicator size="large" color={theme.accent} style={styles.loading} />
      ) : series.length === 0 ? (
        <Text style={styles.empty}>Ez a könyvtár üres.</Text>
      ) : (
        <FlatList
          data={series}
          numColumns={COLS}
          keyExtractor={s => String(s.id)}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.column}
          renderItem={({item}) => (
            <PosterCard
              title={item.display_title ?? item.title}
              uri={mediaUrl(base, token, item.cover_image_url)}
              onPress={() => navigation.navigate('Series', {seriesId: item.id})}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: theme.bg},
  header: {paddingHorizontal: 20, paddingVertical: 12},
  back: {color: theme.muted, fontSize: 15, marginBottom: 6},
  title: {color: '#fff', fontSize: 24, fontWeight: '800'},
  loading: {marginTop: 40},
  error: {color: '#f87171', padding: 24},
  empty: {color: theme.muted, padding: 24, fontSize: 16},
  grid: {paddingHorizontal: 16, paddingBottom: 40},
  column: {gap: 12, marginBottom: 12},
});
