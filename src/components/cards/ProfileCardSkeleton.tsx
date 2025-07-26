import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import ShimmerPlaceHolder from 'react-native-shimmer-placeholder';

const screenWidth = Dimensions.get('window').width;

const ProfileCardSkeleton = () => {
  return (
    <View style={styles.card}>
      <ShimmerPlaceHolder
        style={styles.photo}
        shimmerStyle={{ borderRadius: 16 }}
      />
      <View style={styles.info}>
        <ShimmerPlaceHolder style={styles.textLine} />
        <ShimmerPlaceHolder style={styles.textLineShort} />
        <ShimmerPlaceHolder style={styles.textLine} />
        <ShimmerPlaceHolder style={styles.inviteBtn} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginBottom: 20,
    overflow: 'hidden',
    elevation: 3,
  },
  photo: {
    width: screenWidth - 32,
    height: 260,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  info: {
    padding: 16,
  },
  textLine: {
    height: 16,
    borderRadius: 8,
    marginBottom: 10,
    width: '80%',
  },
  textLineShort: {
    height: 16,
    borderRadius: 8,
    marginBottom: 10,
    width: '50%',
  },
  inviteBtn: {
    marginTop: 12,
    height: 40,
    borderRadius: 10,
    width: '100%',
  },
});

export default ProfileCardSkeleton;
