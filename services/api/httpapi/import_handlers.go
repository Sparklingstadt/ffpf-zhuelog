package httpapi

import (
	"bytes"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/csvimport"
)

const (
	csvImportPath  = "/v1/imports/csv"
	csvFileField   = "csvFile"
	maxCSVFileSize = 4 << 20
	// maxCSVBodyBytes is this route's body limit: the 4 MiB file plus the
	// multipart framing and any other fields. It stays below the 4.5 MB
	// request body limit of Vercel Functions.
	maxCSVBodyBytes = 4<<20 + 256<<10
)

// csvUploadTimeout is how long a CSV upload may take to arrive. It stays under
// the maximum duration of a Vercel Function. It is a var so tests can shorten
// it.
var csvUploadTimeout = 4 * time.Minute

// extendCSVDeadlines gives this one request longer read and write deadlines
// than the server's, so a slow 4 MiB upload can finish and still get a JSON
// answer. It runs after authentication, so unauthenticated requests keep the
// server's deadlines. It uses the real clock, as deadlines are wall-clock
// matters. Writers that cannot set deadlines (http.ErrNotSupported, as in
// httptest.ResponseRecorder) are left alone.
func extendCSVDeadlines(w http.ResponseWriter) {
	rc := http.NewResponseController(w)
	now := time.Now()
	_ = rc.SetReadDeadline(now.Add(csvUploadTimeout))
	_ = rc.SetWriteDeadline(now.Add(csvUploadTimeout + 10*time.Second))
}

// importCSV stores the uploaded CSV in the caller's own notes, validating it
// exactly like the web. The CSV contents are never logged.
func importCSV(e Entries, now func() time.Time) http.Handler {
	type response struct {
		Batch batchJSON `json:"batch"`
		Count int       `json:"count"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := principalFrom(r.Context())
		// Authenticate only returns admin or member, so this cannot fire today;
		// it is kept as defence in depth in case a role is ever added.
		if p.Role != auth.RoleAdmin && p.Role != auth.RoleMember {
			writeForbidden(w, msgForbidden)
			return
		}
		extendCSVDeadlines(w)
		mr, err := r.MultipartReader()
		if err != nil {
			writeBadRequest(w)
			return
		}
		name, content, err := readCSVFile(mr)
		switch {
		case errors.Is(err, errNoCSVFile):
			writeError(w, http.StatusBadRequest, codeInvalidRequest, msgSelectCSVFile)
			return
		case errors.Is(err, errCSVFileTooLarge):
			writeError(w, http.StatusRequestEntityTooLarge, codeTooLarge, msgCSVFileTooLarge)
			return
		case err != nil:
			writeBodyError(w, r, err)
			return
		}
		if !strings.HasSuffix(strings.ToLower(name), ".csv") {
			writeError(w, http.StatusBadRequest, codeInvalidRequest, msgCSVExtension)
			return
		}
		drafts, err := csvimport.Parse(bytes.NewReader(content))
		var fileName string
		if err == nil {
			fileName, err = csvimport.FileName(name)
		}
		var invalid *csvimport.ValidationError
		if errors.As(err, &invalid) {
			writeError(w, http.StatusBadRequest, codeInvalidCSV, invalid.Message)
			return
		}
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		batch, _, err := e.CreateImportBatch(r.Context(), p.OwnerID, fileName, drafts, now())
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusCreated, response{
			Batch: toBatchJSON(batch),
			Count: len(drafts),
		})
	})
}

var (
	errNoCSVFile       = errors.New("httpapi: no csv file")
	errCSVFileTooLarge = errors.New("httpapi: csv file too large")
)

// readCSVFile returns the name and contents of the first csvFile part, like
// the web's formData.get("csvFile"). It fails with errNoCSVFile when that part
// is missing, is not a file or is empty, and with errCSVFileTooLarge past
// 4 MiB, reading at most one byte more than that.
func readCSVFile(mr *multipart.Reader) (string, []byte, error) {
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			return "", nil, errNoCSVFile
		}
		if err != nil {
			return "", nil, err
		}
		if part.FormName() != csvFileField {
			continue // NextPart discards the rest of this part
		}
		name := part.FileName()
		if name == "" {
			return "", nil, errNoCSVFile
		}
		content, err := io.ReadAll(io.LimitReader(part, maxCSVFileSize+1))
		switch {
		case err != nil:
			return "", nil, err
		case len(content) == 0:
			return "", nil, errNoCSVFile
		case len(content) > maxCSVFileSize:
			return "", nil, errCSVFileTooLarge
		}
		return name, content, nil
	}
}
