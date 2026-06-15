import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {useDevice} from '../context/DeviceContext';
import type {RootStackParamList} from '../navigation';
import {theme} from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export default function SettingsScreen({navigation}: Props): React.JSX.Element {
  const {config, clear} = useDevice();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, {paddingTop: insets.top}]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹ Vissza</Text>
        </Pressable>
        <Text style={styles.title}>Beállítások</Text>
      </View>

      <View style={styles.card}>
        <Row label="Szerver" value={config?.serverUrl ?? '—'} />
        <Row label="Eszköz" value={config?.deviceName ?? '—'} />
      </View>

      <Pressable style={styles.action} onPress={() => navigation.navigate('Capability')}>
        <Text style={styles.actionText}>Képességteszt</Text>
      </Pressable>

      <Pressable
        style={styles.unpair}
        onPress={() => {
          void clear(); // navigator swaps back to Welcome when config clears
        }}>
        <Text style={styles.unpairText}>Szétválasztás</Text>
      </Pressable>
    </View>
  );
}

function Row({label, value}: {label: string; value: string}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: theme.bg, padding: 20},
  header: {marginBottom: 20},
  back: {color: theme.muted, fontSize: 15, marginBottom: 6},
  title: {color: '#fff', fontSize: 26, fontWeight: '800'},
  card: {backgroundColor: theme.surface, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 16},
  row: {flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border},
  rowLabel: {color: theme.muted, fontSize: 15},
  rowValue: {color: theme.text, fontSize: 15, flexShrink: 1, marginLeft: 16},
  action: {marginTop: 16, backgroundColor: theme.surface, borderRadius: 999, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: theme.border},
  actionText: {color: theme.text, fontWeight: '700', fontSize: 16},
  unpair: {marginTop: 16, backgroundColor: 'rgba(248,113,113,0.15)', borderRadius: 999, paddingVertical: 14, alignItems: 'center'},
  unpairText: {color: '#f87171', fontWeight: '700', fontSize: 16},
});
