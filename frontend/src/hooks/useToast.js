import { useCallback, useRef, useState } from 'react';

export const useToast = () => {
    const [toasts, setToasts] = useState([]);
    const nextId = useRef(0);

    const addToast = useCallback((message, type = 'success', duration = 3000) => {
        const id = nextId.current++;
        setToasts(prev => [...prev, { id, message, type, duration }]);
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(toast => toast.id !== id));
    }, []);

    return { toasts, addToast, removeToast };
};
