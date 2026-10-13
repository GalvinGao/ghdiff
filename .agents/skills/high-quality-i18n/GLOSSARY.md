# Glossary

Read VOICE.md first. Watch means ghdiff's browser-local repository list, not
GitHub Watch subscriptions. Reviews, comments, automated checks, commits, and
compare ranges are different concepts even when a language borrows technical
English.

## Established entries

| Concept          | Source term                  | Locale | Preferred form                     | Lock type        | Surface/context                                | Allowed inflection             | Evidence                                           |
| ---------------- | ---------------------------- | ------ | ---------------------------------- | ---------------- | ---------------------------------------------- | ------------------------------ | -------------------------------------------------- |
| Product          | ghdiff                       | all 20 | ghdiff                             | Do-not-translate | Product name                                   | None inside token              | User carried forward lowercase voice               |
| Service          | GitHub                       | all 20 | GitHub                             | Do-not-translate | External product                               | Grammar around token           | Existing UI and links                              |
| Identifiers      | owner/repo, SHA, URL, handle | all 20 | Exact supplied value               | Do-not-translate | Technical values                               | No token changes               | `src/lib/githubUrls.ts`, `src/lib/reviewTarget.ts` |
| Repository       | repository / repo            | en     | repository; repo in compact chrome | Contextual       | Code container                                 | repositories / repos           | `src/components/WatchedReposEditor.tsx`            |
| Pull request     | pull request                 | en     | pull request; PR where obvious     | Contextual       | Proposed GitHub change                         | pull requests                  | `src/components/HomeScreen.tsx`                    |
| Local watch list | watch                        | en     | Watch / watched / watch list       | Contextual       | Local list, not notifications                  | Match action/state             | `src/components/WatchOfferDialog.tsx`              |
| Review           | review                       | en     | review                             | Contextual       | Inspect changes or submit review; disambiguate | reviews / reviewing / reviewed | `src/components/ReviewHeader.tsx`                  |
| Change display   | diff                         | en     | diff                               | Contextual       | Unified or split display                       | diffs                          | `src/components/HomeScreen.tsx`                    |

No target-language term is a hard lock before review. Protected names apply to
every target locale. Locks never authorize ungrammatical surrounding text.

## Provisional locale candidates

Every row has lock type **contextual, provisional** and evidence **setup
recommendation, followed by first-pass AI catalog review**. Headings name the
source concept. Nouns allow ordinary inflection; verbs must fit action/state.
These are candidates for review, not a replacement dictionary or approved
translations.

| Locale  | repository   | pull request   | watch (local action) | diff        | merge request    |
| ------- | ------------ | -------------- | -------------------- | ----------- | ---------------- |
| en      | repository   | pull request   | Watch                | diff        | merge request    |
| zh-Hans | 仓库         | 拉取请求       | 关注                 | 差异        | 合并请求         |
| es      | repositorio  | pull request   | Seguir               | diferencias | merge request    |
| fr      | dépôt        | pull request   | Suivre               | différences | merge request    |
| de      | Repository   | Pull Request   | Beobachten           | Diff        | Merge Request    |
| ja      | リポジトリ   | プルリクエスト | ウォッチ             | 差分        | マージリクエスト |
| ko      | 저장소       | 풀 리퀘스트    | 관심 목록에 추가     | 변경 사항   | 머지 리퀘스트    |
| pt-BR   | repositório  | pull request   | Acompanhar           | diferenças  | merge request    |
| ru      | репозиторий  | пул-реквест    | Отслеживать          | различия    | мерж-реквест     |
| hi      | रिपॉज़िटरी   | पुल रिक्वेस्ट  | सूची में जोड़ें      | अंतर        | मर्ज रिक्वेस्ट   |
| ar      | مستودع       | طلب سحب        | متابعة               | الفروق      | طلب دمج          |
| id      | repositori   | pull request   | Pantau               | perbedaan   | merge request    |
| vi      | kho mã       | pull request   | Theo dõi             | khác biệt   | merge request    |
| tr      | depo         | pull request   | Takip et             | farklar     | merge request    |
| pl      | repozytorium | pull request   | Obserwuj             | różnice     | merge request    |
| it      | repository   | pull request   | Segui                | differenze  | merge request    |
| uk      | репозиторій  | пул-реквест    | Відстежувати         | відмінності | мерж-реквест     |
| nl      | repository   | pull request   | Volgen               | verschillen | merge request    |
| fa      | مخزن         | درخواست ادغام  | دنبال کنید           | تفاوت‌ها    | درخواست ادغام    |
| bn      | রিপোজিটরি    | পুল রিকোয়েস্ট | তালিকায় যোগ করুন    | পার্থক্য    | মার্জ রিকোয়েস্ট |

Audit watch candidates for notification/subscription implications; use an
explicit “add to list” construction where needed. Diff may need different forms
as a display name and in prose about changed lines. Review the Persian
pull-request candidate especially: it must not blur a pull request and the
action of merging it. A GitLab merge request is the same concept as a pull
request and follows each locale's pull request choice; Persian has one term for
both, so a sentence that names both names the forge instead.

Target forms for review, checks, approve, request changes, commit, and compare
range have received first-pass contextual AI review in the catalogs; they are
not hard locks or human-validated terminology. Request changes is a review
verdict, not editing files. Checks are automated results, not human reviews.

## Updates

When promoting a candidate, record concept, source term, locale, preferred form,
lock type, surface/context, allowed inflections, and approval evidence. A hard
lock requires an approved concept term; frequency alone is insufficient. Sweep
visible text, errors, menus, accessibility labels, onboarding, count branches,
and the userscript, checking each meaning before editing. There is no remote
glossary.
