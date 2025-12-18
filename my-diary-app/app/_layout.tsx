import { Stack, router } from 'expo-router';
import { useFonts } from 'expo-font';
import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { Platform } from 'react-native';
import mobileAds from 'react-native-google-mobile-ads';
import { requestTrackingPermissionsAsync } from 'expo-tracking-transparency';
import AsyncStorage from '@react-native-async-storage/async-storage';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    // appフォルダから見て「一つ上(../)」にassetsがあるので、これで届きます
    'ZenMaruGothic': require('../assets/fonts/ZenMaruGothic-Regular.ttf'),
  });

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  // AdMob & Tracking Policy Initialization
  useEffect(() => {
    (async () => {
      if (Platform.OS === 'ios') {
        const { status } = await requestTrackingPermissionsAsync();
        console.log('Tracking Status:', status);
      }
      await mobileAds().initialize();
      console.log('✅ AdMob Initialized in _layout');

      // Auth Check
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        // 少し待ってからリダイレクトしないとうまくいかないことがあるため、必要なら調整
        // レイアウトがマウントされた直後だと早すぎる場合があるが、Expo Routerは比較的うまく処理する
        router.replace('/auth/login');
      }
    })();
  }, []);

  if (!loaded && !error) {
    return null;
  }

  return (
    <Stack>
      {/* タブ画面（カレンダー） */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {/* 日記画面（戻るボタンなどのタイトル設定） */}
      <Stack.Screen name="chat" options={{ title: '日記', headerBackTitleVisible: false }} />
      {/* ログイン画面 */}
      <Stack.Screen name="auth/login" options={{ headerShown: false }} />
    </Stack>
  );
}