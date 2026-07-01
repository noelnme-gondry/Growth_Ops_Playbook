"use client";
import { useAppStore } from "@/store/useDataStore";

export default function GlobalModals() {
  const isCmdkOpen = useAppStore((state) => state.isCmdkOpen);
  const setCmdkOpen = useAppStore((state) => state.setCmdkOpen);

  return (
    <>
      <div id="toast-container" className="toast-container" role="status" aria-live="polite"></div>

      {/* ⌘K 명령 팔레트 */}
      <div id="cmdk" className="cmdk-overlay" hidden={!isCmdkOpen}>
        <div className="cmdk-panel" role="dialog" aria-modal="true">
          <div className="cmdk-inputwrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input 
              id="cmdk-input" 
              type="text" 
              placeholder="도구·가이드 이동 또는 명령 실행…" 
              autoComplete="off" 
              spellCheck="false" 
            />
            <kbd onClick={() => setCmdkOpen(false)} style={{cursor: 'pointer'}}>esc</kbd>
          </div>
          <div id="cmdk-results" className="cmdk-results">
             {/* 검색 결과 렌더링 영역 */}
          </div>
          <div className="cmdk-foot">
            <span><kbd>↑</kbd><kbd>↓</kbd> 이동</span>
            <span><kbd>↵</kbd> 실행</span>
            <span onClick={() => setCmdkOpen(false)} style={{cursor: 'pointer'}}><kbd>esc</kbd> 닫기</span>
          </div>
        </div>
      </div>
    </>
  );
}
