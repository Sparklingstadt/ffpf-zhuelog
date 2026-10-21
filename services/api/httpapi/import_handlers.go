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
	maxCSVFileSize = 5 << 20
	// maxCSVBodyBytes is this route's body limit: the 5 MiB file plus the
	// multipart framing and any other fields.
	maxCSVBodyBytes = 6 << 20
)

// importCSV stores the uploaded CSV in the caller's own notes, validating it
// exactly like the web. The CSV contents are never logged.
func importCSV(e Entries, now func() time.Time) http.Handler {
	type batchJSON struct {
		ID         string `json:"id"`
		ImportedAt string `json:"importedAt"`
	}
	type response struct {
		Batch batchJSON `json:"batch"`
		Count int       `json:"count"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := principalFrom(r.Context())
		if p.Role != auth.RoleAdmin && p.Role != auth.RoleMember {
			writeError(w, http.StatusForbidden, "forbidden", msgForbidden)
			return
		}
		mr, err := r.MultipartReader()
		if err != nil {
			writeBadRequest(w)
			return
		}
		name, content, err := readCSVFile(mr)
		switch {
		case errors.Is(err, errNoCSVFile):
			writeError(w, http.StatusBadRequest, "invalid_request", msgSelectCSVFile)
			return
		case errors.Is(err, errCSVFileTooLarge):
			writeError(w, http.StatusRequestEntityTooLarge, "too_large", msgCSVFileTooLarge)
			return
		case err != nil:
			writeBodyError(w, r, err)
			return
		}
		if !strings.HasSuffix(strings.ToLower(name), ".csv") {
			writeError(w, http.StatusBadRequest, "invalid_request", msgCSVExtension)
			return
		}
		drafts, err := csvimport.Parse(bytes.NewReader(content))
		var fileName string
		if err == nil {
			fileName, err = csvimport.FileName(name)
		}
		var invalid *csvimport.ValidationError
		if errors.As(err, &invalid) {
			writeError(w, http.StatusBadRequest, "invalid_csv", invalid.Message)
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
			Batch: batchJSON{ID: batch.ID, ImportedAt: formatTime(batch.ImportedAt)},
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
// 5 MiB, reading at most one byte more than that.
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
