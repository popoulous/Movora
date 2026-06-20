import React from 'react';
import {Image, StyleSheet, Text, View, type StyleProp, type ViewStyle} from 'react-native';

const LOGO = require('../assets/movora_logo.png');

// The Movora brand lockup: the "M" mark + the white wordmark. `wordmark={false}`
// shows just the mark.
export function Brand({
  size = 30,
  wordmark = true,
  style,
}: {
  size?: number;
  wordmark?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  return (
    <View style={[styles.row, style]}>
      <Image source={LOGO} style={{width: size, height: size}} resizeMode="contain" />
      {wordmark && <Text style={[styles.word, {fontSize: size * 0.72}]}>MOVORA</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', gap: 10},
  word: {fontWeight: '800', letterSpacing: 3, color: '#fff'},
});
