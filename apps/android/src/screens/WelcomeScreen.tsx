import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {createPairingClient} from '../api/client';
import {Brand} from '../components/Brand';
import {useDevice} from '../context/DeviceContext';
import {discoverServer} from '../discovery';
import {useI18n} from '../i18n';
import type {RootStackParamList} from '../navigation';
import {theme} from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

type Phase = 'discovering' | 'form' | 'pairing';

export default function WelcomeScreen(_props: Props): React.JSX.Element {
  const {save} = useDevice();
  const {t} = useI18n();
  const [serverUrl, setServerUrl] = useState('http://192.168.1.100:8000');
  const [deviceName, setDeviceName] = useState('Android');
  const [phase, setPhase] = useState<Phase>('discovering');
  const [scan, setScan] = useState({checked: 0, total: 254});
  const [foundUrl, setFoundUrl] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
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

  // Sweep the LAN for a Movora /health marker; prefill the URL if found.
  const runDiscovery = useCallback(() => {
    setPhase('discovering');
    setError(null);
    setScan({checked: 0, total: 254});
    discoverServer(p => setScan(p))
      .then(res => {
        setSearched(true);
        if (res.serverUrl) {
          setServerUrl(res.serverUrl);
          setFoundUrl(res.serverUrl);
        } else {
          setFoundUrl(null);
        }
        setPhase('form');
      })
      .catch(() => {
        setSearched(true);
        setPhase('form');
      });
  }, []);

  useEffect(() => {
    runDiscovery();
  }, [runDiscovery]);

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
          setError(t('welcome.expired'));
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
      <Brand size={44} style={styles.brand} />

      {phase === 'discovering' && (
        <View style={styles.card}>
          <View style={styles.waiting}>
            <ActivityIndicator color={theme.accent} />
            <Text style={styles.waitingText}>{t('welcome.searching')}</Text>
          </View>
          <Text style={styles.scan}>
            {scan.checked} / {scan.total}
          </Text>
          <Pressable onPress={() => setPhase('form')}>
            <Text style={styles.linkText}>{t('welcome.serverUrl')} →</Text>
          </Pressable>
        </View>
      )}

      {phase === 'form' && (
        <View style={styles.card}>
          {foundUrl ? (
            <Text style={styles.found}>{t('welcome.found', {url: foundUrl})}</Text>
          ) : searched ? (
            <Text style={styles.notFound}>{t('welcome.notFound')}</Text>
          ) : null}
          <Text style={styles.label}>{t('welcome.serverUrl')}</Text>
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
          <Text style={styles.label}>{t('welcome.deviceName')}</Text>
          <TextInput
            style={styles.input}
            value={deviceName}
            onChangeText={setDeviceName}
            placeholder="Android"
            placeholderTextColor={theme.muted}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={styles.button} onPress={startPairing}>
            <Text style={styles.buttonText}>{t('welcome.pair')}</Text>
          </Pressable>
          <Pressable onPress={runDiscovery} style={styles.searchAgain}>
            <Text style={styles.linkText}>{t('welcome.searchAgain')}</Text>
          </Pressable>
        </View>
      )}

      {phase === 'pairing' && (
        <View style={styles.card}>
          <Text style={styles.label}>{t('welcome.enterCode')}</Text>
          <Text style={styles.code}>{code}</Text>
          <View style={styles.waiting}>
            <ActivityIndicator color={theme.accent} />
            <Text style={styles.waitingText}>{t('welcome.waiting')}</Text>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 24},
  brand: {marginBottom: 28},
  card: {width: '100%', maxWidth: 480, backgroundColor: theme.surface, borderRadius: theme.radius, padding: 20, borderWidth: 1, borderColor: theme.border},
  label: {color: theme.muted, fontSize: 14, marginBottom: 6, marginTop: 10},
  input: {backgroundColor: 'rgba(255,255,255,0.06)', color: theme.text, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16},
  button: {backgroundColor: theme.accent, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 20},
  buttonText: {color: '#fff', fontWeight: '700', fontSize: 16},
  code: {fontSize: 44, fontWeight: '800', letterSpacing: 10, color: '#fff', textAlign: 'center', marginVertical: 18},
  waiting: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10},
  waitingText: {color: theme.muted, fontSize: 15},
  scan: {color: theme.muted, fontSize: 13, textAlign: 'center', marginTop: 12, fontVariant: ['tabular-nums']},
  found: {color: '#34d399', fontSize: 14, marginBottom: 6},
  notFound: {color: theme.muted, fontSize: 14, marginBottom: 6},
  error: {color: '#f87171', marginTop: 12, fontSize: 14},
  linkText: {color: theme.accent, fontSize: 14, textAlign: 'center', marginTop: 16},
  searchAgain: {marginTop: 4},
});
