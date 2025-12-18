import { View, Text, StyleSheet, TouchableOpacity, Alert, SafeAreaView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';

export default function SettingsScreen() {
    const SERVER_URL = 'https://ai-diary-server.onrender.com';

    const confirmDeleteAccount = () => {
        Alert.alert(
            "アカウント削除",
            "本当にアカウントを削除しますか？\n\n・これまでの日記データは全て消去されます。\n・この操作は取り消せません。",
            [
                {
                    text: "キャンセル",
                    style: "cancel"
                },
                {
                    text: "削除する",
                    style: "destructive",
                    onPress: deleteAccount
                }
            ]
        );
    };

    const deleteAccount = async () => {
        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) return;

            const response = await fetch(`${SERVER_URL}/delete_account`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                await AsyncStorage.removeItem('userToken');
                Alert.alert("削除完了", "アカウントを削除しました。", [
                    { text: "OK", onPress: () => router.replace('/auth/login') }
                ]);
            } else {
                Alert.alert("エラー", "アカウントの削除に失敗しました。時間をおいて再度お試しください。");
            }
        } catch (error) {
            console.error("Delete account error:", error);
            Alert.alert("エラー", "通信エラーが発生しました。");
        }
    };

    const handleLogout = async () => {
        Alert.alert("ログアウト", "ログアウトしますか？", [
            { text: "キャンセル", style: "cancel" },
            {
                text: "ログアウト",
                onPress: async () => {
                    await AsyncStorage.removeItem('userToken');
                    router.replace('/auth/login');
                }
            }
        ]);
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>設定</Text>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>アカウント</Text>

                <TouchableOpacity style={styles.item} onPress={handleLogout}>
                    <Text style={styles.itemText}>ログアウト</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.item, styles.deleteItem]} onPress={confirmDeleteAccount}>
                    <Text style={[styles.itemText, styles.deleteText]}>アカウント削除</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.footer}>
                <Text style={styles.version}>Version 1.0.3</Text>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fffdf5',
    },
    header: {
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#5d4037',
        fontFamily: 'ZenMaruGothic',
    },
    section: {
        marginTop: 20,
        paddingHorizontal: 20,
    },
    sectionTitle: {
        fontSize: 14,
        color: '#888',
        marginBottom: 10,
        fontFamily: 'ZenMaruGothic',
    },
    item: {
        backgroundColor: 'white',
        padding: 16,
        borderRadius: 12,
        marginBottom: 10,
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 1,
        },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    itemText: {
        fontSize: 16,
        color: '#333',
        fontFamily: 'ZenMaruGothic',
    },
    deleteItem: {
        marginTop: 20,
        backgroundColor: '#FFF0F0',
    },
    deleteText: {
        color: '#FF3B30',
        fontWeight: 'bold',
    },
    footer: {
        marginTop: 'auto',
        padding: 20,
        alignItems: 'center',
    },
    version: {
        color: '#ccc',
        fontSize: 12,
    }
});
