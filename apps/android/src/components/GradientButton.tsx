import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, type StyleProp, type ViewStyle} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import {theme} from '../theme';

// The primary CTA: a gradient pill (Play / Continue / Pair). Focusable so the Android TV
// D-pad gets a visible focus glow.
export function GradientButton({
  label,
  onPress,
  style,
}: {
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.wrap, focused && styles.focused, style]}>
      <LinearGradient
        colors={theme.gradient}
        start={{x: 0, y: 0}}
        end={{x: 1, y: 0}}
        style={styles.grad}>
        <Text style={styles.label}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {borderRadius: 999, overflow: 'hidden'},
  focused: {borderWidth: 2, borderColor: '#fff'},
  grad: {paddingVertical: 13, paddingHorizontal: 30, alignItems: 'center', justifyContent: 'center'},
  label: {color: '#fff', fontWeight: '700', fontSize: 16},
});
