# VIA Links - Full-Stack URL Shortener

[vialinks.xyz](https://vialinks.xyz)는 Cloudflare의 초저지연 에지 네트워크를 활용하여 구축된 강력한 풀스택 서버리스 애플리케이션입니다. 긴 링크와 텍스트를 커스텀 경로를 통해 신속하게 공유할 수 있으며, 강력한 보안과 실시간 분석 기능을 제공합니다.

## 핵심 특징

- **풀스택 에지 네트워킹**: 모든 백엔드 로직과 스토리지 처리가 전 세계 Cloudflare 에지 노드에 분산되어 최상의 성능과 가용성을 보장합니다.
- **이중 계층 스토리지 최적화**: 리디렉션 읽기 작업용 **Cloudflare KV**와 만료된 링크 아카이브용 **D1 SQL 데이터베이스**를 결합하여 데이터 처리 효율성을 극대화했습니다.
- **End-to-End 암호화 (E2EE)**: 비밀번호 설정 시 클라이언트 사이드에서 모든 데이터 암복호화가 이루어지며 완벽한 프라이버시를 보장합니다.
  - **KDF (키 파생 함수)**: 브라우저 상에서 `argon2id` (WebAssembly) 알고리즘을 사용해 사용자의 비밀번호와 랜덤 생성된 Salt(16 bytes)로부터 강력한 256-bit 암호화 키를 파생합니다. (파라미터: time 3, mem 256MB, parallelism 1)
  - **암호화 알고리즘**: 파생된 키와 랜덤 IV(12 bytes)를 이용해 Web Crypto API의 **AES-GCM (256-bit)** 방식으로 데이터를 암호화합니다. 무결성 검증을 포함하여 조작을 방지합니다.
> 개인용으로 개발했기에 저사양 기기 최적화를 고려하지 않았습니다.
  - **Zero-Knowledge**: 원본 URL 및 텍스트 콘텐츠는 클라이언트에서 암호화된 `enc_data` 형태로 변환되며, 서버에는 원본 대신 더미 데이터와 암호화된 페이로드만 전송/저장되므로 서버 운영자조차 내용을 절대 확인할 수 없습니다.
- **실시간 데이터 분석**: **Workers Analytics Engine**을 통합하여 링크별 클릭 수 및 유입 데이터를 실시간으로 추적하고 관리자 대시보드에서 시각화합니다.
- **강력한 보안**: **Cloudflare Turnstile**을 통한 봇 방지 및 지능형 크롤러 감지 시스템이 탑재되어 있습니다.
- **자동화된 수명 주기 관리**: **Cron 트리거**를 통해 설정된 만료 시간에 맞춰 링크를 자동으로 관리하고 D1으로 아카이브합니다.
- **정적 페이지 호스팅**: 관리자 전용 기능으로 HTML 페이지를 키 기반 URL(`vialinks.xyz/주소`)로 발급하며, 본문은 **R2**에 저장됩니다. 활성 데이터는 KV, 비활성 데이터는 D1에 저장되는 기존 수명주기 구조를 그대로 따릅니다.
- **뉴모피즘 모바일 반응형 UI**: CSS 미디어 쿼리를 활용한 완벽한 모바일 반응형 레이아웃을 제공합니다. 고급스러운 화면 전환 애니메이션과 접근성 표준을 준수하는 뉴모피즘 디자인의 프론트엔드를 경험할 수 있습니다.
- **즉시 QR 코드 생성**: 링크 생성 시 즉시 고해상도 QR 코드를 생성하여 오프라인 공유를 지원합니다.

## 프로젝트 구조

### 백엔드 & 인프라
- `index.js`: **Hono** 프레임워크를 기반으로 구축된 애플리케이션의 핵심 로직입니다. 효율적인 API 라우팅, 미들웨어 처리, 리다이렉션 및 데이터 연동을 수행합니다.
- `wrangler.toml`: KV, D1, R2, Analytics Engine 및 Cron 트리거 등 Cloudflare 리소스와 환경 변수를 정의하는 설정 파일입니다.
- `schema.sql`: D1 데이터베이스의 테이블 스키마 정의 파일로, 만료된 링크의 아카이빙 구조를 관리합니다.

### 프론트엔드 (UI/UX)
- `index.html`: 메인 랜딩 페이지입니다. 링크/텍스트 생성 폼, Turnstile 연동, 실시간 QR 생성 로직이 포함되어 있습니다.
- `index.css`: 뉴모피즘 디자인 시스템과 페이지 전환 애니메이션을 정의하는 메인 스타일시트입니다.
- `admin-login.html` & `admin-dashboard.html`: 관리자 전용 인터페이스입니다. 세션 기반 보안 로그인과 실시간 통계 및 링크 관리 기능을 제공합니다.
- `password.html`: 암호화된 링크 접근 시 사용되는 인터페이스로, 클라이언트 사이드 복호화 로직을 수행합니다.
- `paste.html`: 텍스트 공유 내용을 표시하기 위한 전용 템플릿 페이지입니다.
- `utils.html`: AES 암복호화, Base64 변환, 랜덤 문자열 생성 등 유용한 도구 모음을 제공하는 유틸리티 페이지입니다.
- `error.html` & `404.css/js`: 사용자 경험을 고려한 커스텀 에러 및 404 페이지입니다.

## 기술 스택

- **Backend**: Cloudflare Workers, **Hono** Framework (Node.js Compatibility)
- **Database**: Cloudflare KV (Key-Value), Cloudflare D1 (SQLite)
- **Analytics**: Cloudflare Workers Analytics Engine
- **Storage**: Cloudflare R2
- **Security**: Cloudflare Turnstile, Web Crypto API (AES-GCM 256-bit), Argon2id (KDF)
- **Frontend**: HTML5, CSS3 (Neumorphism), JavaScript, Axios, SweetAlert2, Bootstrap 

