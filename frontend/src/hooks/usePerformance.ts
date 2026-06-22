import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Debounce de valores para evitar re-renders excessivos
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}

/**
 * Throttle para funções que são chamadas muitas vezes
 */
export function useThrottledCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delayMs = 1000
): T {
  const lastRun = useRef(Date.now());

  return useCallback(
    (...args: unknown[]) => {
      const now = Date.now();
      if (now - lastRun.current >= delayMs) {
        lastRun.current = now;
        callback(...args);
      }
    },
    [callback, delayMs]
  ) as T;
}

/**
 * Mantém valor anterior para comparações
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}

/**
 * Effect que roda apenas uma vez (similar ao componentDidMount)
 */
export function useMount(effect: () => void | (() => void)) {
  useEffect(() => effect(), []);
}

/**
 * Effect que roda quando componente é desmontado
 */
export function useUnmount(effect: () => void) {
  useEffect(() => effect, []);
}

/**
 * Async state com loading/error
 */
export function useAsync<T>(
  asyncFunction: () => Promise<T>,
  immediate = true
): { data: T | null; loading: boolean; error: Error | null } {
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: Error | null;
  }>({
    data: null,
    loading: immediate,
    error: null
  });

  const execute = useCallback(async () => {
    setState({ data: null, loading: true, error: null });
    try {
      const result = await asyncFunction();
      setState({ data: result, loading: false, error: null });
      return result;
    } catch (error) {
      setState({ data: null, loading: false, error: error as Error });
      throw error;
    }
  }, [asyncFunction]);

  useEffect(() => {
    if (immediate) {
      execute();
    }
  }, [execute, immediate]);

  return state;
}

/**
 * State que persiste em localStorage
 */
export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T) => {
      try {
        setStoredValue(value);
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Silently fail if localStorage is unavailable
      }
    },
    [key]
  );

  return [storedValue, setValue];
}

/**
 * Hook para trackear se componente está no viewport
 */
export function useInView(ref: React.RefObject<HTMLElement>, options = {}): boolean {
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    if (!ref.current) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]) {
        setIsInView(entries[0].isIntersecting);
      }
    }, { threshold: 0.1, ...options });

    observer.observe(ref.current);

    return () => observer.disconnect();
  }, [ref, options]);

  return isInView;
}

/**
 * Hook para media queries
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    if (media.matches !== matches) {
      setMatches(media.matches);
    }

    const listener = () => setMatches(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [matches, query]);

  return matches;
}
