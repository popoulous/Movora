import {DarkTheme, NavigationContainer, type Theme} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import React from 'react';
import {ActivityIndicator, StatusBar, StyleSheet, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {DeviceProvider, useDevice} from './context/DeviceContext';
import type {RootStackParamList} from './navigation';
import CapabilityScreen from './screens/CapabilityScreen';
import HomeScreen from './screens/HomeScreen';
import LibraryScreen from './screens/LibraryScreen';
import PlayerScreen from './screens/PlayerScreen';
import SeriesScreen from './screens/SeriesScreen';
import SettingsScreen from './screens/SettingsScreen';
import WelcomeScreen from './screens/WelcomeScreen';
import {theme} from './theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme: Theme = {
  ...DarkTheme,
  colors: {...DarkTheme.colors, background: theme.bg, card: theme.bg, text: theme.text},
};

function Root(): React.JSX.Element {
  const {config, ready} = useDevice();

  if (!ready) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{headerShown: false, animation: 'fade'}}>
      {config ? (
        <Stack.Group>
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Library" component={LibraryScreen} />
          <Stack.Screen name="Series" component={SeriesScreen} />
          <Stack.Screen name="Player" component={PlayerScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="Capability" component={CapabilityScreen} />
        </Stack.Group>
      ) : (
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
      )}
    </Stack.Navigator>
  );
}

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <DeviceProvider>
        <NavigationContainer theme={navTheme}>
          <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
          <Root />
        </NavigationContainer>
      </DeviceProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center'},
});
