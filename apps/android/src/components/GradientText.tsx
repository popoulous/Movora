import MaskedView from '@react-native-masked-view/masked-view';
import React from 'react';
import {StyleSheet, Text, type StyleProp, type TextStyle} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import {theme} from '../theme';

// Gradient-filled text — the Movora wordmark/accent look. MaskedView clips the gradient
// to the glyph shapes; the hidden inner Text sizes the gradient to the text bounds.
export function GradientText({
  children,
  style,
  colors = theme.gradient,
}: {
  children: string;
  style?: StyleProp<TextStyle>;
  colors?: [string, string];
}): React.JSX.Element {
  return (
    <MaskedView maskElement={<Text style={style}>{children}</Text>}>
      <LinearGradient colors={colors} start={{x: 0, y: 0}} end={{x: 1, y: 0}}>
        <Text style={[style, styles.hidden]}>{children}</Text>
      </LinearGradient>
    </MaskedView>
  );
}

const styles = StyleSheet.create({
  hidden: {opacity: 0},
});
