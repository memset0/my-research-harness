package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"time"
)

func main() {
	if len(os.Args) != 2 {
		panic("expected a temporary fixture directory")
	}
	dir := os.Args[1]
	if err := os.MkdirAll(dir, 0700); err != nil {
		panic(err)
	}
	write := func(name string, bytes []byte) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, bytes, 0600); err != nil {
			panic(err)
		}
		return p
	}
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		panic(err)
	}
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "test-ca"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	caDER, err := x509.CreateCertificate(rand.Reader, ca, ca, &caKey.PublicKey, caKey)
	if err != nil {
		panic(err)
	}
	ca, err = x509.ParseCertificate(caDER)
	if err != nil {
		panic(err)
	}
	makeLeaf := func(name string, serial int64, usage x509.ExtKeyUsage) (string, string, []byte) {
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			panic(err)
		}
		template := &x509.Certificate{SerialNumber: big.NewInt(serial), Subject: pkix.Name{CommonName: name}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{usage}}
		if usage == x509.ExtKeyUsageServerAuth {
			template.DNSNames = []string{"localhost"}
			template.IPAddresses = []net.IP{net.ParseIP("127.0.0.1")}
		}
		der, err := x509.CreateCertificate(rand.Reader, template, ca, &key.PublicKey, caKey)
		if err != nil {
			panic(err)
		}
		keyDER, err := x509.MarshalPKCS8PrivateKey(key)
		if err != nil {
			panic(err)
		}
		return write(name+".pem", pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})), write(name+".key", pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})), der
	}
	server, serverKey, _ := makeLeaf("server", 2, x509.ExtKeyUsageServerAuth)
	client, clientKey, der := makeLeaf("client", 3, x509.ExtKeyUsageClientAuth)
	sum := sha256.Sum256(der)
	value := map[string]string{"ca": write("ca.pem", pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})), "server": server, "serverKey": serverKey, "client": client, "clientKey": clientKey, "fingerprint": hex.EncodeToString(sum[:])}
	bytes, _ := json.Marshal(value)
	fmt.Println(string(bytes))
}
