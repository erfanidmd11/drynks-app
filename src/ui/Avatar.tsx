import React from 'react';
import { Image, ImageStyle } from 'react-native';

// Local fallback (make sure this file exists; creation command below)
const placeholder = require('../../assets/images/avatar-placeholder.png');

type Props = {
  url?: string | null;
  size?: number;
  style?: ImageStyle;
};

export function Avatar({ url, size = 40, style }: Props) {
  const source =
    url && /^https?:\/\//i.test(url) ? { uri: url } : placeholder;

  return (
    <Image
      source={source}
      style={[{ width: size, height: size, borderRadius: size / 2 }, style]}
      resizeMode="cover"
    />
  );
}

export default Avatar;
