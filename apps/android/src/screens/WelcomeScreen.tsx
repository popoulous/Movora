import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {createPairingClient} from '../api/client';
import {useDevice} from '../context/DeviceContext';
import type {RootStackParamList} from '../navigation';
import {theme} from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

type Phase = 'form' | 'pairing';

export default function WelcomeScreen(_props: Props): React.JSX.Element {
  const {save} = useDevice();
  const [serverUrl, setServerUrl] = useState('http://192.168.1.100:8000');
  const [deviceName, setDeviceName] = useState('Android');
  const [phase, setPhase] = useState<Phase>('form');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
      }
    },
    [],
  );

  const startPairing = async (): Promise<void> => {
    setError(null);
    const url = serverUrl.trim().replace(/\/$/, '');
    const api = createPairingClient(url);
    try {
      const started = await api.pairStart(deviceName.trim() || 'Android');
      setCode(started.code);
      setPhase('pairing');
      poll(url, started.code);
    } catch (e) {
      setError(String(e));
    }
  };

  const poll = (url: string, pairCode: string): void => {
    const api = createPairingClient(url);
    const tick = async (): Promise<void> => {
      try {
        const res = await api.pairStatus(pairCode);
        if (res.status === 'approved' && res.device_token) {
          await save({serverUrl: url, deviceToken: res.device_token, deviceName});
          return; // navigator swaps to Home once config is set
        }
        if (res.status === 'expired') {
          setError('A párosítási kód lejárt. Próbáld újra.');
          setPhase('form');
          return;
        }
      } catch (e) {
        setError(String(e));
        setPhase('form');
        return;
      }
      pollTimer.current = setTimeout(tick, 2500);
    };
    void tick();
  };

  return (
    <View style={styles.root}>
      <Text style={styles.logo}>MOVORA</Text>

      {phase === 'form' ? (
        <View style={styles.card}>
          <Text style={styles.label}>Szerver címe</Text>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.1.100:8000"
            placeholderTextColor={theme.muted}
          />
          <Text style={styles.label}>Eszköz neve</Text>
          <TextInput
            style={styles.input}
            value={deviceName}
            onChangeText={setDeviceName}
            placeholder="Android"
            placeholderTextColor={theme.muted}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={styles.button} onPress={startPairing}>
            <Text style={styles.buttonText}>Párosítás</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.label}>Írd be ezt a kódot a Movora weben (Beállítások → TV párosítása):</Text>
          <Text style={styles.code}>{code}</Text>
          <View style={styles.waiting}>
            <ActivityIndicator color={theme.accent} />
            <Text style={styles.waitingText}>Jóváhagyásra várok…</Text>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 24},
  logo: {fontSize: 34, fontWeight: '800', letterSpacing: 6, color: '#fff', marginBottom: 28},
  card: {width: '100%', maxWidth: 480, backgroundColor: theme.surface, borderRadius: theme.radius, padding: 20, borderWidth: 1, borderColor: theme.border},
  label: {color: theme.muted, fontSize: 14, marginBottom: 6, marginTop: 10},
  input: {backgroundColor: 'rgba(255,255,255,0.06)', color: theme.text, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16},
  button: {backgroundColor: theme.accent, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 20},
  buttonText: {color: '#fff', fontWeight: '700', fontSize: 16},
  code: {fontSize: 44, fontWeight: '800', letterSpacing: 10, color: '#fff', textAlign: 'center', marginVertical: 18},
  waiting: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10},
  waitingText: {color: theme.muted, fontSize: 15},
  error: {color: '#f87171', marginTop: 12, fontSize: 14},
});
