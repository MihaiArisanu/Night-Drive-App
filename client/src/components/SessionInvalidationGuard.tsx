import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { NavigationProp, ParamListBase, useNavigation } from '@react-navigation/native';
import { AuthStorage } from '../services/api';
import { subscribeToSessionInvalidation } from '../services/sessionEvents';

export default function SessionInvalidationGuard() {
    const navigation = useNavigation<NavigationProp<ParamListBase>>();
    const isHandlingInvalidation = useRef(false);

    useEffect(() => subscribeToSessionInvalidation(({ message }) => {
        if (isHandlingInvalidation.current) {
            return;
        }
        isHandlingInvalidation.current = true;

        const showSessionEndedAlert = () => {
            Alert.alert(
                'Session ended',
                message,
                [{
                    text: 'OK',
                    onPress: () => {
                        navigation.reset({
                            index: 0,
                            routes: [{ name: 'Auth', params: { isLogin: true } }],
                        });
                        isHandlingInvalidation.current = false;
                    },
                }],
                { cancelable: false },
            );
        };

        AuthStorage.clearTokens().then(showSessionEndedAlert, (error) => {
            console.error('Could not clear the replaced session:', error);
            showSessionEndedAlert();
        });
    }), [navigation]);

    return null;
}
