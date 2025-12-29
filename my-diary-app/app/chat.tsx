import { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, SafeAreaView, ActivityIndicator, Modal, Alert, Image } from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function ChatScreen() {
  // === ↓↓↓ IPアドレスを書き換えてください ↓↓↓ ===
  const SERVER_URL = 'https://ai-diary-server.onrender.com';
  // ===========================================

  // 型定義
  type Message = {
    role: string;
    content: string;
    image?: string;
    temp_image_uri?: string | null;
    timestamp?: string; // ★時刻追加
  };

  const { date } = useLocalSearchParams();
  const targetDate = date ? String(date) : new Date().toISOString().split('T')[0];

  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [isTyping, setIsTyping] = useState(false); // ★タイピング状態
  const [diaryTitle, setDiaryTitle] = useState(targetDate);

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [editingText, setEditingText] = useState('');

  useEffect(() => {
    fetchHistory();
  }, [targetDate]);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('userToken');
      if (!token) return router.replace('/auth/login');

      const response = await fetch(`${SERVER_URL}/history?date_id=${targetDate}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.status === 401) {
        await AsyncStorage.removeItem('userToken');
        Alert.alert("セッション切れ", "ログインし直してください");
        return router.replace('/auth/login');
      }
      const data = await response.json();

      if (data.title && data.icon) setDiaryTitle(`${data.icon} ${data.title}`);
      else setDiaryTitle(targetDate);

      if (data.messages.length === 0) startConversation();
      else setMessages(data.messages);
    } catch (error) { console.error('履歴取得エラー:', error); }
    finally { setLoading(false); }
  };

  const startConversation = async () => {
    try {
      const startMessage = { role: 'user', content: '__START__' };
      const token = await AsyncStorage.getItem('userToken');

      const response = await fetch(`${SERVER_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ date_id: targetDate, messages: [startMessage] }),
      });

      if (response.status === 401) {
        await AsyncStorage.removeItem('userToken');
        Alert.alert("セッション切れ", "ログインし直してください");
        return router.replace('/auth/login');
      }
      const data = await response.json();
      setMessages([{ role: 'assistant', content: data.reply }]);
      if (data.title && data.icon) setDiaryTitle(`${data.icon} ${data.title}`);
    } catch (error) { console.error(error); }
  };

  const pickImage = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permissionResult.granted === false) { alert("許可が必要です"); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [4, 3], quality: 0.5, base64: true,
    });
    if (!result.canceled) {
      setSelectedImage(result.assets[0].uri);
      setImageBase64(result.assets[0].base64 ?? null);
    }
  };

  const cancelImage = () => { setSelectedImage(null); setImageBase64(null); };

  // ★会話終了機能
  const endConversation = async () => {
    Alert.alert("会話を終了しますか？", "今日のまとめと、AIからの励ましメッセージをもらいます。", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "終了する",
        onPress: async () => {
          try {
            setIsTyping(true);
            const token = await AsyncStorage.getItem('userToken');
            const response = await fetch(`${SERVER_URL}/summary`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ date_id: targetDate }),
            });

            if (response.status === 401) {
              await AsyncStorage.removeItem('userToken');
              return router.replace('/auth/login');
            }

            const data = await response.json();
            // まとめメッセージをシステムメッセージとして追加
            const summaryMessage = { role: 'assistant', content: data.summary, timestamp: getCurrentTime() };
            setMessages(prev => [...prev, summaryMessage]);
            setIsTyping(false);
          } catch (error) {
            console.error(error);
            setIsTyping(false);
            Alert.alert("エラー", "まとめの取得に失敗しました");
          }
        }
      }
    ]);
  };

  const getCurrentTime = () => {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  };

  const sendMessage = async () => {
    if (inputText.trim() === '' && !imageBase64) return;

    // ★送信直後の画面表示用（一時的なローカル画像）
    const userMessage: Message = {
      role: 'user',
      content: inputText,
      // サーバー送信前は、ローカルのselectedImageを表示用に使う
      temp_image_uri: selectedImage,
      timestamp: getCurrentTime() // ★時刻記録
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputText('');
    setSelectedImage(null);
    setIsTyping(true); // ★タイピング開始

    try {
      const token = await AsyncStorage.getItem('userToken');
      const response = await fetch(`${SERVER_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          date_id: targetDate,
          messages: newMessages,
          new_image: imageBase64
        }),
      });

      if (response.status === 401) {
        await AsyncStorage.removeItem('userToken');
        Alert.alert("セッション切れ", "ログインし直してください");
        return router.replace('/auth/login');
      }
      const data = await response.json();

      // ★サーバーから最新の履歴を取得しなおす（保存された画像URLを反映するため）
      // 簡易的に、AIの返事だけ追加するのではなく、fetchHistoryと同じ要領でリフレッシュする手もありますが、
      // ここではスムーズに見せるために「次のロード時」に正式な画像URLに切り替わります。
      setMessages([...newMessages, { role: 'assistant', content: data.reply, timestamp: getCurrentTime() }]);

      if (data.title && data.icon) setDiaryTitle(`${data.icon} ${data.title}`);
      setImageBase64(null);

    } catch (error) { console.error(error); }
    finally { setIsTyping(false); } // ★タイピング終了
  };

  // ... (メニュー操作系) ...
  // ... (メニュー操作系) ...
  const openMenu = (index: number, content: string) => { if (messages[index].role === 'user') { setEditingIndex(index); setEditingText(content); setEditModalVisible(true); } };
  const saveEdit = async () => {
    const updatedMessages = [...messages]; updatedMessages[editingIndex].content = editingText;
    setMessages(updatedMessages); setEditModalVisible(false); await syncToServer(updatedMessages);
  };
  const deleteMessage = () => {
    Alert.alert("削除", "消しますか？", [{ text: "キャンセル" }, {
      text: "削除", style: "destructive", onPress: async () => {
        const updatedMessages = [...messages];
        if (updatedMessages[editingIndex + 1]?.role === 'assistant') updatedMessages.splice(editingIndex, 2);
        else updatedMessages.splice(editingIndex, 1);
        setMessages(updatedMessages); setEditModalVisible(false); await syncToServer(updatedMessages);
      }
    }]);
  };
  const syncToServer = async (newMessages: Message[]) => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      await fetch(`${SERVER_URL}/history`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ date_id: targetDate, messages: newMessages }),
      });
    } catch (error) { console.error("保存エラー:", error); }
  };

  // ★ここが表示のキモ！
  const renderItem = ({ item, index }: { item: Message; index: number }) => {
    const isUser = item.role === 'user';

    // 画像URLの決定
    // 1. 送信直後で、まだローカルにある場合 (temp_image_uri)
    // 2. 保存済みで、サーバーにある場合 (image) -> http://IP:8000/images/xxxx.jpg に変換
    let imageSource = null;
    if (item.temp_image_uri) {
      imageSource = { uri: item.temp_image_uri };
    } else if (item.image) {
      imageSource = { uri: `${SERVER_URL}/images/${item.image}` };
    }

    if (isUser) {
      return (
        <TouchableOpacity onLongPress={() => openMenu(index, item.content)}>
          <View style={{ alignItems: 'flex-end', marginBottom: 5 }}>
            <View style={styles.notebookLine}>
              {/* 画像があれば表示 */}
              {imageSource && <Image source={imageSource} style={styles.chatImage} />}
              {item.content ? <Text style={styles.userText}>{item.content}</Text> : null}
            </View>
            {item.timestamp && <Text style={styles.timestamp}>{item.timestamp}</Text>}
          </View>
        </TouchableOpacity>
      );
    } else {
      return (
        <View style={{ alignItems: 'flex-start', marginBottom: 15 }}>
          <View style={styles.aiCommentBlock}>
            <Text style={styles.aiText}>✍️ {item.content}</Text>
          </View>
          {item.timestamp && <Text style={styles.timestamp}>{item.timestamp}</Text>}
        </View>
      );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{
        title: diaryTitle,
        headerStyle: { backgroundColor: '#fffdf5' },
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: 'ZenMaruGothic', color: '#5d4037' },
        headerRight: () => (
          <TouchableOpacity onPress={endConversation} style={{ marginRight: 10 }}>
            <Ionicons name="checkmark-done-circle-outline" size={28} color="#5d4037" />
          </TouchableOpacity>
        )
      }} />

      {loading ? (<View style={styles.center}><ActivityIndicator size="large" color="#aaa" /></View>) : (
        <FlatList
          data={messages}
          renderItem={renderItem}
          keyExtractor={(item, index) => index.toString()}
          contentContainerStyle={styles.noteList}
          ListFooterComponent={
            isTyping ? (
              <View style={styles.typingContainer}>
                <ActivityIndicator size="small" color="#aaa" />
                <Text style={styles.typingText}>カキダシ中...</Text>
              </View>
            ) : null
          }
        />
      )}

      {selectedImage && (
        <View style={styles.imagePreviewContainer}>
          <Image source={{ uri: selectedImage }} style={styles.imagePreview} />
          <TouchableOpacity onPress={cancelImage} style={styles.closeButton}><Ionicons name="close-circle" size={24} color="#fff" /></TouchableOpacity>
        </View>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.inputContainer}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
      >
        <TouchableOpacity onPress={pickImage} style={styles.cameraButton}>
          <Ionicons name="camera-outline" size={28} color="#555" />
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="いま何してる？"
          placeholderTextColor="#aaa"
          multiline
        />
        <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
          <Ionicons name="arrow-up-circle" size={32} color="#333" />
        </TouchableOpacity>
      </KeyboardAvoidingView>

      <Modal animationType="fade" transparent={true} visible={editModalVisible} onRequestClose={() => setEditModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>操作を選択</Text>
            <TextInput style={styles.modalInput} value={editingText} onChangeText={setEditingText} multiline />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.deleteButton} onPress={deleteMessage}><Ionicons name="trash-outline" size={20} color="#ff4444" /><Text style={styles.deleteText}>削除</Text></TouchableOpacity>
              <View style={styles.rightButtons}>
                <TouchableOpacity style={styles.cancelButton} onPress={() => setEditModalVisible(false)}><Text style={styles.buttonText}>キャンセル</Text></TouchableOpacity>
                <TouchableOpacity style={styles.saveButton} onPress={saveEdit}><Text style={styles.saveButtonText}>修正保存</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fffdf5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  noteList: { paddingHorizontal: 20, paddingBottom: 100, paddingTop: 10 },
  notebookLine: { borderBottomWidth: 1, borderBottomColor: '#e0e0e0', paddingVertical: 12, marginBottom: 5 },
  userText: { fontSize: 16, color: '#333', lineHeight: 26, fontFamily: 'ZenMaruGothic' },
  aiCommentBlock: { marginTop: 5, marginBottom: 15, paddingLeft: 10, backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 8, padding: 8 },
  aiText: { fontSize: 13, color: '#666', fontFamily: 'ZenMaruGothic' },
  inputContainer: { flexDirection: 'row', padding: 15, backgroundColor: '#fffdf5', borderTopWidth: 1, borderColor: '#eee', alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#fff', borderRadius: 8, padding: 12, marginRight: 10, fontSize: 16, borderWidth: 1, borderColor: '#ddd', maxHeight: 100, fontFamily: 'ZenMaruGothic' },
  sendButton: { justifyContent: 'center' },
  cameraButton: { marginRight: 10 },
  imagePreviewContainer: { flexDirection: 'row', padding: 10, backgroundColor: '#eee', alignItems: 'center' },
  imagePreview: { width: 60, height: 60, borderRadius: 5, marginRight: 10 },
  closeButton: { position: 'absolute', top: 5, right: 5 },
  chatImage: { width: 200, height: 150, borderRadius: 10, marginBottom: 10, resizeMode: 'cover' }, // ★画像のスタイル
  modalOverlay: { flex: 1, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 20 },
  modalContent: { backgroundColor: '#fff', borderRadius: 15, padding: 20 },
  modalTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 15, textAlign: 'center', color: '#555', fontFamily: 'ZenMaruGothic' },
  modalInput: { backgroundColor: '#f9f9f9', borderRadius: 10, padding: 15, height: 120, textAlignVertical: 'top', fontSize: 16, marginBottom: 20, borderWidth: 1, borderColor: '#eee', fontFamily: 'ZenMaruGothic' },
  modalButtons: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rightButtons: { flexDirection: 'row' },
  deleteButton: { flexDirection: 'row', alignItems: 'center', padding: 10 },
  deleteText: { color: '#ff4444', fontWeight: 'bold', marginLeft: 5, fontFamily: 'ZenMaruGothic' },
  cancelButton: { padding: 10, marginRight: 10 },
  saveButton: { backgroundColor: '#333', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20 },
  buttonText: { color: '#555', fontFamily: 'ZenMaruGothic' },
  saveButtonText: { color: '#fff', fontWeight: 'bold', fontFamily: 'ZenMaruGothic' },
  timestamp: { fontSize: 10, color: '#999', marginTop: 2, marginHorizontal: 5, fontFamily: 'ZenMaruGothic' },
  typingContainer: { flexDirection: 'row', alignItems: 'center', marginVertical: 10, marginLeft: 10 },
  typingText: { marginLeft: 5, color: '#aaa', fontSize: 12, fontFamily: 'ZenMaruGothic' },
});