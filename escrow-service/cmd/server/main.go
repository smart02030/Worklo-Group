package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	"github.com/worklo/escrow-service/internal/handler"
	"github.com/worklo/escrow-service/internal/repository"
	"github.com/worklo/escrow-service/internal/service"
)

func main() {
	// Load .env if present (development convenience)
	_ = godotenv.Load("../../.env.local")

	supabaseURL := os.Getenv("NEXT_PUBLIC_SUPABASE_URL")
	supabaseKey := os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
	if supabaseURL == "" || supabaseKey == "" {
		log.Fatal("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
	}

	repo := repository.New(supabaseURL, supabaseKey)
	svc := service.New(repo)
	h := handler.New(svc)

	r := mux.NewRouter()
	r.HandleFunc("/escrow", h.CreateEscrow).Methods(http.MethodPost)
	r.HandleFunc("/escrow/{id}", h.GetEscrow).Methods(http.MethodGet)
	r.HandleFunc("/escrow/{id}/approve-milestone", h.ApproveMilestone).Methods(http.MethodPost)
	r.HandleFunc("/escrow/{id}/claim-milestone", h.ClaimMilestone).Methods(http.MethodPost)

	port := os.Getenv("PORT")
	if port == "" {
		port = "4001"
	}

	log.Printf("escrow-service listening on :%s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
