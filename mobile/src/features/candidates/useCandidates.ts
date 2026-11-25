import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadCandidatePage,
  type CandidateStatusFilter,
  type CandidateSummary
} from "@/shared/data/candidateRepository";

interface CandidateListState {
  status: "loading" | "ready" | "error";
  items: CandidateSummary[];
  total: number;
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
}

const initialState: CandidateListState = {
  status: "loading",
  items: [],
  total: 0,
  refreshing: false,
  loadingMore: false,
  error: null
};

export function useCandidates(ownerId: string, statusFilter: CandidateStatusFilter, municipality: string) {
  const requestSequence = useRef(0);
  const [state, setState] = useState<CandidateListState>(initialState);

  const refresh = useCallback(async (manual = false) => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;

    if (!ownerId) {
      setState({ ...initialState, status: "error", error: "Sessione utente non disponibile. Acceda nuovamente." });
      return;
    }

    setState({ ...initialState, status: "loading", refreshing: manual });

    try {
      const page = await loadCandidatePage(ownerId, statusFilter, municipality, 0);
      if (requestSequence.current !== requestId) return;
      setState({
        status: "ready",
        items: page.items,
        total: page.total,
        refreshing: false,
        loadingMore: false,
        error: null
      });
    } catch {
      if (requestSequence.current !== requestId) return;
      setState({
        ...initialState,
        status: "error",
        error: "Non è stato possibile caricare le opportunità. Riprovi tra qualche istante."
      });
    }
  }, [ownerId, statusFilter, municipality]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void refresh();
    });
    return () => {
      active = false;
      requestSequence.current += 1;
    };
  }, [refresh]);

  const loadMore = useCallback(async () => {
    if (
      !ownerId ||
      state.status !== "ready" ||
      state.loadingMore ||
      state.items.length >= state.total
    ) return;

    const requestId = requestSequence.current;
    const offset = state.items.length;
    setState(previous => ({ ...previous, loadingMore: true, error: null }));

    try {
      const page = await loadCandidatePage(ownerId, statusFilter, municipality, offset);
      if (requestSequence.current !== requestId) return;
      setState(previous => ({
        ...previous,
        items: previous.items.concat(page.items),
        total: page.total,
        loadingMore: false,
        error: null
      }));
    } catch {
      if (requestSequence.current !== requestId) return;
      setState(previous => ({
        ...previous,
        loadingMore: false,
        error: "Non è stato possibile caricare le altre opportunità. Riprovi."
      }));
    }
  }, [ownerId, statusFilter, municipality, state.status, state.loadingMore, state.items.length, state.total]);

  return {
    ...state,
    hasMore: state.items.length < state.total,
    refresh,
    loadMore
  };
}
