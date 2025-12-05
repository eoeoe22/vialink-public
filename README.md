# VIA Links - URL Shortener

Cloudflare Workers 기반 URL 단축 서비스
https://vialinks.xyz

## 기능

- URL 단축 생성
- 단축 URL 리다이렉션
- 클릭 수 추적
- Cloudflare Turnstile 보안 확인
- 관리자 인터페이스
- Cloudflare KV를 이용한 데이터 저장

## 설정

1. Cloudflare Dashboard에서 KV Namespace 생성
2. `wrangler.toml`에 KV Namespace ID 설정
3. 환경 변수 설정:
   - `DOMAIN`: 도메인 이름
   - `TURNSTILE_SITE_KEY`: Turnstile 사이트 키
   - `TURNSTILE_SECRET_KEY`: Turnstile 시크릿 키
   - `MANAGEMENT_PASSWORD`: 관리자 비밀번호

## 개발

```bash
# 로컬 개발 서버 시작
npm run dev

# 배포
npm run deploy
```

## API

### POST /api/v1/short/
URL 단축 생성

```json
{
  "key": "my-key",
  "url": "https://example.com",
  "turnstile_token": "token"
}
```

### GET /{key}
단축 URL 리다이렉션

### GET /manage
관리자 인터페이스 (Basic 인증 필요)
