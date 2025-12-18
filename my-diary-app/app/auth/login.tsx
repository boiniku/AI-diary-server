import { useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';

export default function LoginScreen() {
    const SERVER_URL = 'https://ai-diary-server.onrender.com';

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isRegistering, setIsRegistering] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleAuth = async () => {
        if (!username || !password) {
            Alert.alert('エラー', 'ユーザー名とパスワードを入力してください');
            return;
        }

        if (isRegistering && password !== confirmPassword) {
            Alert.alert('エラー', 'パスワードが一致しません');
            return;
        }

        setLoading(true);
        try {
            if (isRegistering) {
                // === 新規登録 ===
                const registerRes = await fetch(`${SERVER_URL}/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password }),
                });

                if (!registerRes.ok) {
                    let errorDetail = '登録に失敗しました';
                    try {
                        const errData = await registerRes.json();
                        errorDetail = errData.detail || errorDetail;
                    } catch (e) {
                        const errText = await registerRes.text();
                        errorDetail = `サーバーエラー (${registerRes.status}): ${errText.slice(0, 100)}`;
                    }
                    throw new Error(errorDetail);
                }

                // 登録成功したらそのままログインフローへ
                Alert.alert('成功', 'アカウントを作成しました！ログインします...');
            }

            // === ログイン (トークン取得) ===
            // FastAPIのOAuth2PasswordRequestFormは form-data を期待する
            const formData = new URLSearchParams();
            formData.append('username', username);
            formData.append('password', password);

            const loginRes = await fetch(`${SERVER_URL}/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData.toString(),
            });

            if (!loginRes.ok) {
                let errorDetail = 'ユーザー名またはパスワードが違います';
                try {
                    const errData = await loginRes.json();
                    errorDetail = errData.detail || errorDetail;
                } catch (e) {
                    const errText = await loginRes.text();
                    errorDetail = `サーバーエラー (${loginRes.status}): ${errText.slice(0, 100)}`;
                }
                throw new Error(errorDetail);
            }

            const data = await loginRes.json();
            const token = data.access_token;

            // トークン保存
            await AsyncStorage.setItem('userToken', token);

            // ホームへ遷移
            router.replace('/(tabs)');

        } catch (error: any) {
            Alert.alert('エラー', error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.container}
        >
            <View style={styles.content}>
                <Text style={styles.title}></Text>
                <Text style={styles.subtitle}>{isRegistering ? 'アカウント作成' : 'ログイン'}</Text>

                <View style={styles.inputContainer}>
                    <Text style={styles.label}>ユーザー名</Text>
                    <TextInput
                        style={styles.input}
                        value={username}
                        onChangeText={setUsername}
                        autoCapitalize="none"
                    />
                </View>

                <View style={styles.inputContainer}>
                    <Text style={styles.label}>パスワード</Text>
                    <TextInput
                        style={styles.input}
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                    />
                </View>

                {isRegistering && (
                    <View style={styles.inputContainer}>
                        <Text style={styles.label}>パスワード（確認）</Text>
                        <TextInput
                            style={styles.input}
                            value={confirmPassword}
                            onChangeText={setConfirmPassword}
                            secureTextEntry
                        />
                    </View>
                )}

                <TouchableOpacity style={styles.button} onPress={handleAuth} disabled={loading}>
                    {loading ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={styles.buttonText}>{isRegistering ? '登録してはじめる' : 'ログイン'}</Text>
                    )}
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setIsRegistering(!isRegistering)} style={styles.switchButton}>
                    <Text style={styles.switchText}>
                        {isRegistering ? 'すでにアカウントをお持ちの方はこちら' : 'アカウント作成はこちら'}
                    </Text>
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fffdf5', justifyContent: 'center', padding: 20 },
    content: { width: '100%', maxWidth: 400, alignSelf: 'center' },
    title: { fontSize: 32, textAlign: 'center', marginBottom: 10, color: '#5d4037', fontFamily: 'ZenMaruGothic', fontWeight: 'bold' },
    subtitle: { fontSize: 18, textAlign: 'center', marginBottom: 30, color: '#8d6e63', fontFamily: 'ZenMaruGothic' },
    inputContainer: { marginBottom: 15 },
    label: { marginBottom: 5, color: '#5d4037', fontFamily: 'ZenMaruGothic' },
    input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16, fontFamily: 'ZenMaruGothic' },
    button: { backgroundColor: '#FFB74D', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold', fontFamily: 'ZenMaruGothic' },
    switchButton: { marginTop: 20, alignItems: 'center' },
    switchText: { color: '#007AFF', fontFamily: 'ZenMaruGothic' },
});
