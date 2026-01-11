import { StyleSheet, View, Text, SafeAreaView, Platform, TouchableOpacity, Animated, TextInput, ScrollView, FlatList, ActivityIndicator } from 'react-native';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import { router, useFocusEffect } from 'expo-router';
import { useState, useCallback, useRef } from 'react';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

// アニメーション付きボタン
const TouchableScale = ({ onPress, children, style }: any) => {
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = () => Animated.spring(scale, { toValue: 0.95, useNativeDriver: true }).start();
  const onPressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();
  return (
    <TouchableOpacity onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </TouchableOpacity>
  );
};

LocaleConfig.locales['jp'] = {
  monthNames: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  monthNamesShort: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  dayNames: ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'],
  dayNamesShort: ['日', '月', '火', '水', '木', '金', '土'],
};
LocaleConfig.defaultLocale = 'jp';

// 開発中(__DEV__)はテストIDを使い、本番ビルド時のみ本番IDを使うように切り替えます
const adUnitId = __DEV__
  ? TestIds.BANNER
  : (Platform.select({
    ios: 'ca-app-pub-4541342273103383/9735812807',
    android: 'ca-app-pub-3940256099942544/6300978111',
  }) ?? TestIds.BANNER);
// const adUnitId = __DEV__
//   ? TestIds.BANNER
//   : (Platform.select({
//     ios: 'ca-app-pub-4541342273103383/9735812807',
//     android: 'ca-app-pub-3940256099942544/6300978111',
//   }) ?? TestIds.BANNER);

interface SearchResult {
  date_id: string;
  title: string;
  score: number;
  icon: string;
}

export default function CalendarScreen() {
  const SERVER_URL = 'https://ai-diary-server.onrender.com';
  const [markedDates, setMarkedDates] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  useFocusEffect(
    useCallback(() => {
      fetchCalendarData();
    }, [])
  );

  const fetchCalendarData = async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) return router.replace('/auth/login');

      const response = await fetch(`${SERVER_URL}/calendar`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      const newMarkedDates: Record<string, any> = {};
      Object.keys(data).forEach(date => {
        const item = data[date];
        const score = (typeof item === 'object') ? item.score : item;
        let color = '#E0E0E0';
        let textColor = '#333';
        if (score >= 5) { color = '#FFB74D'; textColor = '#fff'; }
        else if (score === 4) { color = '#FFE0B2'; }
        else if (score === 3) { color = '#E0E0E0'; }
        else if (score === 2) { color = '#BBDEFB'; }
        else if (score <= 1) { color = '#64B5F6'; textColor = '#fff'; }
        newMarkedDates[date] = {
          customStyles: {
            container: { backgroundColor: color, borderRadius: 8 },
            text: { color: textColor, fontWeight: 'bold' }
          }
        };
      });
      setMarkedDates(newMarkedDates);
    } catch (error: any) {
      console.error("カレンダー取得エラー:", error);
      // Silent failure for server error in production potentially preferred, keeping dev alert only
      if (__DEV__) {
        // alert(`サーバー接続エラー: ${error?.message}\nURL: ${SERVER_URL}`);
      }
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setHasSearched(true);
    try {
      const token = await AsyncStorage.getItem('userToken');
      const response = await fetch(`${SERVER_URL}/search?q=${encodeURIComponent(searchQuery)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setSearchResults(data);
      } else {
        setSearchResults([]);
      }
    } catch (error) {
      console.error("検索エラー:", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>カキダシ</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        <View style={styles.calendarContainer}>
          <Calendar
            onDayPress={(day: any) => {
              router.push({ pathname: '/chat', params: { date: day.dateString } });
            }}
            monthFormat={'yyyy年 MM月'}
            markingType={'custom'}
            markedDates={markedDates}
            theme={{
              todayTextColor: '#007AFF',
              arrowColor: '#007AFF',
              textDayFontFamily: 'ZenMaruGothic',
              textMonthFontFamily: 'ZenMaruGothic',
              textDayHeaderFontFamily: 'ZenMaruGothic'
            }}
          />
        </View>

        <View style={styles.legend}>
          <Text style={styles.legendText}>😆 楽しい</Text>
          <View style={[styles.dot, { backgroundColor: '#FFB74D' }]} />
          <View style={[styles.dot, { backgroundColor: '#E0E0E0' }]} />
          <View style={[styles.dot, { backgroundColor: '#64B5F6' }]} />
          <Text style={styles.legendText}>悲しい 😢</Text>
        </View>

        <View style={styles.todayButtonContainer}>
          <TouchableScale
            style={styles.todayButton}
            onPress={() => {
              const today = new Date().toISOString().split('T')[0];
              router.push({ pathname: '/chat', params: { date: today } });
            }}
          >
            <Ionicons name="pencil" size={20} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.todayButtonText}>今日の日記を書く</Text>
          </TouchableScale>
        </View>

        <View style={styles.searchContainer}>
          <Text style={styles.searchHeader}>日記を検索</Text>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={20} color="#999" />
            <TextInput
              style={styles.searchInput}
              placeholder="キーワードを入力..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
              onSubmitEditing={handleSearch}
            />
            <TouchableOpacity onPress={handleSearch} style={styles.searchButton}>
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>検索</Text>
            </TouchableOpacity>
          </View>

          {isSearching && <ActivityIndicator style={{ marginTop: 20 }} color="#5d4037" />}

          {!isSearching && hasSearched && searchResults.length === 0 && (
            <Text style={styles.noResultText}>見つかりませんでした</Text>
          )}

          {!isSearching && searchResults.map((item) => (
            <TouchableOpacity
              key={item.date_id}
              style={styles.resultItem}
              onPress={() => router.push({ pathname: '/chat', params: { date: item.date_id } })}
            >
              <Text style={styles.resultIcon}>{item.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.resultDate}>{item.date_id}</Text>
                <Text style={styles.resultTitle}>{item.title}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#ccc" />
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.adContainer}>
          <BannerAd
            unitId={adUnitId}
            size={BannerAdSize.BANNER}
            requestOptions={{
              requestNonPersonalizedAdsOnly: true,
            }}
            onAdLoaded={() => console.log('✅ 広告表示成功！')}
            onAdFailedToLoad={(error: any) => {
              // サイレント失敗：エラーを表示しない
              console.log('❌ 広告読み込み失敗（ユーザーには表示しません）:', error);
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fffdf5' },
  header: { padding: 20, alignItems: 'center' },
  title: { fontSize: 22, color: '#5d4037', fontFamily: 'ZenMaruGothic' },
  calendarContainer: { marginTop: 10, paddingHorizontal: 10 },
  legend: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 30, gap: 10 },
  legendText: { fontFamily: 'ZenMaruGothic', color: '#666' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  adContainer: {
    alignItems: 'center',
    marginTop: 20,
    width: '100%',
    paddingBottom: 20,
  },
  todayButtonContainer: { marginTop: 20, paddingHorizontal: 40, width: '100%', alignItems: 'center' },
  todayButton: {
    backgroundColor: '#5d4037', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, paddingHorizontal: 30, borderRadius: 25,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 3.84, elevation: 5
  },
  todayButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold', fontFamily: 'ZenMaruGothic' },

  // Search Styles
  searchContainer: { marginTop: 30, paddingHorizontal: 20 },
  searchHeader: { fontSize: 18, fontFamily: 'ZenMaruGothic', color: '#5d4037', marginBottom: 10 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2
  },
  searchInput: { flex: 1, marginLeft: 10, fontFamily: 'ZenMaruGothic', fontSize: 16 },
  searchButton: { backgroundColor: '#5d4037', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 8, marginLeft: 5 },
  noResultText: { textAlign: 'center', marginTop: 20, color: '#999', fontFamily: 'ZenMaruGothic' },
  resultItem: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 15, borderRadius: 10, marginTop: 10,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1
  },
  resultIcon: { fontSize: 24, marginRight: 15 },
  resultDate: { fontSize: 12, color: '#999', fontFamily: 'ZenMaruGothic' },
  resultTitle: { fontSize: 16, color: '#333', fontFamily: 'ZenMaruGothic', fontWeight: 'bold' }
});