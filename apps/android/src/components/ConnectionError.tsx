// Shown when the app cannot reach the server it is paired with.
//
// Without this the app was a dead end: Settings — which holds the unpair action — lives
// behind the loaded Home screen, so a server that changed address left nothing but a
// spinner, and the only way out was clearing the app's data. The screen offers the way
// out, and first tries to avoid needing it: a moved server is the common cause, so it
// sweeps the LAN and offers to switch. The pairing token belongs to the device rather
// than to the address, so switching keeps the device paired.

import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';

import {useDevice} from '../context/DeviceContext';
import {discoverServer} from '../discovery';
import {useI18n} from '../i18n';
import {theme} from '../theme';
import {Brand} from './Brand';

interface Props {
  error: string;
  onRetry: () => void;
}

export function ConnectionError({error, onRetry}: Props): React.JSX.Element {
  const {config, save, clear} = useDevice();
  const {t} = useI18n();
  const [searching, setSearching] = useState(true);
  const [found, setFound] = useState<string | null>(null);

  const configured = config?.serverUrl ?? null;

  useEffect(() => {
    let cancelled = false;
    discoverServer()
      .then(res => {
        if (!cancelled) {
          setFound(res.serverUrl && res.serverUrl !== configured ? res.serverUrl : null);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setSearching(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [configured]);

  const switchTo = (url: string): void => {
    if (config) {
      void save({...config, serverUrl: url});
    }
  };

  return (
    <View style={styles.root}>
      <Brand size={40} style={styles.brand} />
      <View style={styles.card}>
        <Text style={styles.title}>{t('connection.title')}</Text>
        <Text style={styles.url}>{configured ?? '—'}</Text>
        <Text style={styles.detail}>{error}</Text>

        {searching ? (
          <View style={styles.waiting}>
            <ActivityIndicator color={theme.accent} />
            <Text style={styles.waitingText}>{t('welcome.searching')}</Text>
          </View>
        ) : null}

        {!searching && found ? (
          <View>
            <Text style={styles.found}>{t('welcome.found', {url: found})}</Text>
            <Pressable style={styles.button} onPress={() => switchTo(found)}>
              <Text style={styles.buttonText}>{t('connection.switch')}</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable style={styles.secondary} onPress={onRetry}>
          <Text style={styles.secondaryText}>{t('common.retry')}</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            void clear(); // navigator swaps back to Welcome when the config clears
          }}>
          <Text style={styles.linkText}>{t('connection.change')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 24},
  brand: {marginBottom: 28},
  card: {width: '100%', maxWidth: 480, backgroundColor: theme.surface, borderRadius: theme.radius, padding: 20, borderWidth: 1, borderColor: theme.border},
  title: {color: theme.text, fontSize: 18, fontWeight: '700'},
  url: {color: theme.muted, fontSize: 14, marginTop: 6},
  detail: {color: '#f87171', fontSize: 13, marginTop: 10},
  waiting: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 18},
  waitingText: {color: theme.muted, fontSize: 15},
  found: {color: '#34d399', fontSize: 14, marginTop: 18},
  button: {backgroundColor: theme.accent, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 12},
  buttonText: {color: '#fff', fontWeight: '700', fontSize: 16},
  secondary: {borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 16},
  secondaryText: {color: theme.text, fontSize: 15, fontWeight: '600'},
  linkText: {color: theme.accent, fontSize: 14, textAlign: 'center', marginTop: 16},
});
