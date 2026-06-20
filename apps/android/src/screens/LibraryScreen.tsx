import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import React, {useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {mediaUrl, type SeriesSummary} from '../api/client';
import {useDevice} from '../context/DeviceContext';
import {useI18n, type Key} from '../i18n';
import type {RootStackParamList} from '../navigation';
import {theme} from '../theme';
import {PosterCard} from './HomeScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'Library'>;

const COLS = 3;
const FILTERS = ['all', 'watching', 'completed'] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_KEY: Record<Filter, Key> = {
  all: 'library.all',
  watching: 'library.watching',
  completed: 'library.completed',
};

export default function LibraryScreen({navigation, route}: Props): React.JSX.Element {
  const {api, config} = useDevice();
  const {t} = useI18n();
  const insets = useSafeAreaInsets();
  const {libraryId, name} = route.params;
  const [series, setSeries] = useState<SeriesSummary[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);

  const base = config?.serverUrl ?? '';
  const token = config?.deviceToken ?? null;

  useEffect(() => {
    if (!api) {
      return;
    }
    api.listSeries(libraryId).then(setSeries).catch((e: unknown) => setError(String(e)));
  }, [api, libraryId]);

  const shown = useMemo(
    () =>
      (series ?? []).filter(s =>
        filter === 'watching'
          ? s.watch_status === 'watching'
          : filter === 'completed'
            ? s.watch_status === 'completed'
            : true,
      ),
    [series, filter],
  );

  return (
    <View style={[styles.root, {paddingTop: insets.top}]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹ {t('common.back')}</Text>
        </Pressable>
        <Text style={styles.title}>{name ?? t('library.defaultName')}</Text>
      </View>

      <View style={styles.filters}>
        {FILTERS.map(f => (
          <FilterChip key={f} label={t(FILTER_KEY[f])} active={filter === f} onPress={() => setFilter(f)} />
        ))}
      </View>

      {error ? (
        <Text style={styles.error}>{t('common.loadError', {error})}</Text>
      ) : !series ? (
        <ActivityIndicator size="large" color={theme.accent} style={styles.loading} />
      ) : shown.length === 0 ? (
        <Text style={styles.empty}>{t('library.empty')}</Text>
      ) : (
        <FlatList
          data={shown}
          numColumns={COLS}
          keyExtractor={s => String(s.id)}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.column}
          renderItem={({item}) => (
            <PosterCard
              title={item.display_title ?? item.title}
              uri={mediaUrl(base, token, item.cover_image_url)}
              progress={item.watch_percent}
              normalized={item.normalized}
              onPress={() => navigation.navigate('Series', {seriesId: item.id})}
            />
          )}
        />
      )}
    </View>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  if (active) {
    return (
      <Pressable onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
        <LinearGradient
          colors={theme.gradient}
          start={{x: 0, y: 0}}
          end={{x: 1, y: 0}}
          style={[styles.chip, focused && styles.chipFocused]}>
          <Text style={styles.chipTextActive}>{label}</Text>
        </LinearGradient>
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.chip, styles.chipIdle, focused && styles.chipFocused]}>
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: theme.bg},
  header: {paddingHorizontal: 20, paddingVertical: 12},
  back: {color: theme.muted, fontSize: 15, marginBottom: 6},
  title: {color: '#fff', fontSize: 24, fontWeight: '800'},
  filters: {flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginBottom: 12},
  chip: {paddingVertical: 8, paddingHorizontal: 18, borderRadius: 999},
  chipIdle: {backgroundColor: theme.surfaceStrong, borderWidth: 1, borderColor: theme.border},
  chipFocused: {borderWidth: 2, borderColor: '#fff'},
  chipText: {color: theme.muted, fontSize: 14, fontWeight: '600'},
  chipTextActive: {color: '#fff', fontSize: 14, fontWeight: '700'},
  loading: {marginTop: 40},
  error: {color: '#f87171', padding: 24},
  empty: {color: theme.muted, padding: 24, fontSize: 16},
  grid: {paddingHorizontal: 16, paddingBottom: 40},
  column: {gap: 12, marginBottom: 12},
});
